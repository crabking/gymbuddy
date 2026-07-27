import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhook } from "@clerk/tanstack-react-start/webhooks";
import type { UserJSON, WebhookEvent } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db.server";
import { billingPayments, billingSubscriptions, clerkEvents, users } from "@/db/schema";
import { authProvider, billingProvider } from "@/lib/auth-config.server";
import { provisionClerkIdentity, type ClerkIdentity } from "@/lib/identity.server";

function webhookUserIdentity(user: UserJSON): ClerkIdentity {
  const primary =
    user.email_addresses.find((email) => email.id === user.primary_email_address_id) ??
    user.email_addresses[0];
  if (!primary?.email_address) throw new Error("Clerk user webhook has no email");
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return {
    id: user.id,
    email: primary.email_address.toLowerCase(),
    emailVerified: primary.verification?.status === "verified",
    externalId: user.external_id,
    displayName: name || null,
  };
}

function toIso(value: number | undefined | null) {
  return value ? new Date(value).toISOString() : null;
}

async function localUserId(clerkUserId: string | undefined) {
  if (!clerkUserId) return null;
  const [user] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerk_user_id, clerkUserId))
    .limit(1);
  return user?.id ?? null;
}

async function syncBillingEvent(event: WebhookEvent) {
  if (billingProvider() !== "clerk") return;
  const db = getDb();

  switch (event.type) {
    case "subscriptionItem.created":
    case "subscriptionItem.updated":
    case "subscriptionItem.active":
    case "subscriptionItem.canceled":
    case "subscriptionItem.upcoming":
    case "subscriptionItem.ended":
    case "subscriptionItem.abandoned":
    case "subscriptionItem.incomplete":
    case "subscriptionItem.pastDue":
    case "subscriptionItem.freeTrialEnding": {
      const item = event.data;
      const clerkUserId = item.payer?.user_id;
      const userId = await localUserId(clerkUserId);
      const values = {
        user_id: userId,
        clerk_user_id: clerkUserId,
        plan_id: item.plan?.id ?? item.plan_id,
        plan_slug: item.plan?.slug,
        status: item.status,
        period_start: toIso(item.period_start),
        period_end: toIso(item.period_end),
        canceled_at: toIso(item.canceled_at),
      };
      await db
        .insert(billingSubscriptions)
        .values({ clerk_subscription_item_id: item.id, ...values })
        .onConflictDoUpdate({
          target: billingSubscriptions.clerk_subscription_item_id,
          set: values,
        });
      return;
    }
    case "subscription.created":
    case "subscription.updated":
    case "subscription.active":
    case "subscription.pastDue": {
      const subscription = event.data;
      const clerkUserId = subscription.payer?.user_id;
      const userId = await localUserId(clerkUserId);
      for (const item of subscription.items) {
        const values = {
          clerk_subscription_id: subscription.id,
          user_id: userId,
          clerk_user_id: clerkUserId,
          plan_id: item.plan?.id ?? item.plan_id,
          plan_slug: item.plan?.slug,
          status: item.status,
          period_start: toIso(item.period_start),
          period_end: toIso(item.period_end),
          canceled_at: toIso(item.canceled_at),
        };
        await db
          .insert(billingSubscriptions)
          .values({ clerk_subscription_item_id: item.id, ...values })
          .onConflictDoUpdate({
            target: billingSubscriptions.clerk_subscription_item_id,
            set: values,
          });
      }
      return;
    }
    case "paymentAttempt.created":
    case "paymentAttempt.updated": {
      const payment = event.data;
      const clerkUserId = payment.payer.user_id;
      const userId = await localUserId(clerkUserId);
      const occurredAt = toIso(payment.paid_at ?? payment.failed_at ?? payment.updated_at)!;
      await db
        .insert(billingPayments)
        .values({
          id: payment.id,
          user_id: userId,
          clerk_user_id: clerkUserId,
          status: payment.status,
          amount_minor: payment.totals.grand_total.amount,
          currency: payment.totals.grand_total.currency.toUpperCase(),
          charge_type: payment.charge_type,
          occurred_at: occurredAt,
        })
        .onConflictDoUpdate({
          target: billingPayments.id,
          set: {
            user_id: userId,
            status: payment.status,
            amount_minor: payment.totals.grand_total.amount,
            currency: payment.totals.grand_total.currency.toUpperCase(),
            occurred_at: occurredAt,
          },
        });
      return;
    }
    default:
      return;
  }
}

function entityId(event: WebhookEvent) {
  return "id" in event.data && typeof event.data.id === "string" ? event.data.id : null;
}

export const Route = createFileRoute("/api/clerk/webhooks")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (authProvider() !== "clerk") {
          return new Response("Clerk authentication is disabled", { status: 404 });
        }
        const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();
        if (!signingSecret) return new Response("Webhook unavailable", { status: 503 });
        const eventId = request.headers.get("svix-id");
        if (!eventId) return new Response("Missing webhook id", { status: 400 });

        const raw = await request.clone().text();
        let event: WebhookEvent;
        try {
          event = await verifyWebhook(request, { signingSecret });
        } catch (error) {
          console.error("Clerk webhook verification failed", error);
          return new Response("Invalid webhook signature", { status: 400 });
        }

        const [receipt] = await getDb()
          .select({ id: clerkEvents.id })
          .from(clerkEvents)
          .where(eq(clerkEvents.id, eventId))
          .limit(1);
        if (receipt) return Response.json({ ok: true, duplicate: true });

        try {
          if (event.type === "user.created" || event.type === "user.updated") {
            const identity = webhookUserIdentity(event.data);
            // Never claim an invited account by an unverified email. Clerk
            // emits user.updated after verification, and request-time
            // provisioning covers the same transition synchronously.
            if (identity.emailVerified) await provisionClerkIdentity(identity);
          } else if (event.type === "user.deleted" && event.data.id) {
            await getDb().delete(users).where(eq(users.clerk_user_id, event.data.id));
          } else {
            await syncBillingEvent(event);
          }

          await getDb()
            .insert(clerkEvents)
            .values({
              id: eventId,
              event_type: event.type,
              entity_id: entityId(event),
              payload_sha256: createHash("sha256").update(raw).digest("hex"),
            })
            .onConflictDoNothing({ target: clerkEvents.id });
          return Response.json({ ok: true });
        } catch (error) {
          console.error("Clerk webhook processing failed", error);
          return new Response("Webhook processing failed", { status: 500 });
        }
      },
    },
  },
});
