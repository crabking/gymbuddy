import type { LegalSection } from "@/components/LegalDocument";
import type { Language } from "@/lib/i18n";

export type PublicLegalConfig = {
  operatorName: string;
  contactEmail: string | null;
  country: string;
  appEnvironment: string;
  detailsComplete: boolean;
};

const contact = (config: PublicLegalConfig, language: Language) =>
  config.contactEmail
    ? language === "sv"
      ? `Kontakta ${config.operatorName} på ${config.contactEmail}.`
      : `Contact ${config.operatorName} at ${config.contactEmail}.`
    : language === "sv"
      ? "Använd sidan för kontoradering och integritetsförfrågningar. Offentlig registrering är avstängd tills en direkt kontaktadress har publicerats."
      : "Use the account deletion and privacy request page. Public registration is disabled until a direct contact address is published.";

export function privacyContent(config: PublicLegalConfig, language: Language) {
  if (language === "sv") {
    return {
      title: "Integritetspolicy",
      intro: `${config.operatorName} behandlar tränings- och hälsorelaterade uppgifter för att leverera COACH. Policyn förklarar vad som lagras, varför det behövs och vilka val du har.`,
      sections: [
        {
          title: "Personuppgiftsansvarig",
          paragraphs: [
            `${config.operatorName} är personuppgiftsansvarig för COACH och är baserad i ${config.country}. ${contact(config, language)}`,
          ],
        },
        {
          title: "Uppgifter vi behandlar",
          bullets: [
            "Konto: e-postadress, namn, verifieringsstatus, sessioner, säkerhetsinställningar och samtyckeshistorik. Lösenord lagras endast som saltade hashvärden.",
            "Profil: namn, ålder, kön, längd, vikt, språk, mål, erfarenhet, utrustning, kost och eventuella skador eller begränsningar.",
            "Träning: program, genomförda och överhoppade pass, vikter, repetitioner, återhämtningssvar och progression.",
            "Kost och mätningar: måltidsbeskrivningar, uppskattade kalorier, näringsämnen, kroppsvikt och andra mått som du väljer att logga.",
            "Coachning: chattmeddelanden, permanenta minnen och agentens sparade arbetsfiler.",
            "Teknisk säkerhetsdata: begränsade serverloggar, tidszon, versionsinformation och hashad enhetsinformation vid samtycke.",
            "Drift- och produktanalys: sidvisningar, registrerings- och betalningssteg, antal chattmeddelanden, slutförda funktioner, AI-tokenanvändning och uppskattad kost. Analysloggen innehåller inte chatttext, måltidsinnehåll, kroppsmått, IP-adress eller user-agent.",
            "Betalningar när de aktiveras: plan, prenumerationsstatus och betalningshändelser. COACH lagrar inte fullständiga kort- eller bankuppgifter.",
          ],
        },
        {
          title: "Matfoton",
          paragraphs: [
            "Foton förbereds på enheten och skickas till den valda AI-leverantören för den aktuella analysen. Själva fotofilen sparas inte i COACH-databasen. En textnotering om att en bild användes kan finnas kvar i chatthistoriken.",
          ],
        },
        {
          title: "Varför och med vilken rättslig grund",
          bullets: [
            "Avtal: autentisering, program, träningslogg, coachning och kontofunktioner.",
            "Uttryckligt samtycke: hälsorelaterade uppgifter, inklusive skador, kroppsmått, träning och kost.",
            "Berättigat intresse: begränsad säkerhet, bedrägeriförebyggande och driftsäkerhet, när detta inte väger tyngre än dina rättigheter.",
            "Berättigat intresse: integritetsbegränsad förstapartsanalys för att förstå registrering, tillförlitlighet, produktanvändning och kostnader utan annonserings- eller tredjepartsspårning.",
            "Rättslig skyldighet: uppgifter som måste sparas enligt tillämplig lag.",
          ],
        },
        {
          title: "AI och personuppgiftsbiträden",
          paragraphs: [
            "Chatttext, relevant profil- och träningskontext samt bilder du aktivt bifogar kan skickas till den AI-leverantör som operatören har konfigurerat. Better Auth körs i COACH egen servermiljö och skickar inte kontodata till en separat identitetsleverantör. E-postleverantören behandlar adresser och säkerhetsmeddelanden. Om betalningar aktiveras behandlar Stripe betalnings-, faktura- och skatteuppgifter. Databas-, server- och infrastrukturföretag behandlar uppgifter endast för att driva tjänsten. Aktuella leverantörer, personuppgiftsbiträdesavtal och internationella överföringar ska dokumenteras före offentlig lansering.",
          ],
        },
        {
          title: "Lagring och delning",
          paragraphs: [
            "Kontodata sparas så länge kontot finns eller så länge lagen kräver det. Integritetsbegränsade produkt- och AI-analyshändelser raderas automatiskt enligt den konfigurerade analysperioden; konto-ID kopplas bort vid kontoradering. Verifierade betalningsbokföringsposter kan sparas separat så länge lag kräver. COACH säljer inte personuppgifter, använder inte tredjepartsannonsering och använder ingen analyscookie. Säkerhetskopior ska roteras enligt publicerad lagringspolicy och raderade konton ska försvinna när backupcykeln löper ut.",
          ],
        },
        {
          title: "Dina rättigheter",
          paragraphs: [
            "Du kan hämta en kopia av dina uppgifter och radera kontot i Inställningar. Du kan även begära tillgång, rättelse, begränsning, dataportabilitet, invända mot viss behandling eller återkalla samtycke. Återkallat hälsosamtycke innebär att COACH inte längre kan leverera kärntjänsten. Du kan klaga hos Integritetsskyddsmyndigheten, IMY.",
          ],
        },
        {
          title: "Ålder och ändringar",
          paragraphs: [
            "COACH är för personer som är minst 18 år. Väsentliga policyändringar kräver ett nytt aktivt godkännande innan tjänsten kan användas vidare.",
          ],
        },
      ] satisfies LegalSection[],
    };
  }
  return {
    title: "Privacy policy",
    intro: `${config.operatorName} processes training and health-related information to provide COACH. This notice explains what is stored, why it is needed, and the choices you have.`,
    sections: [
      {
        title: "Controller",
        paragraphs: [
          `${config.operatorName} is the controller for COACH and is based in ${config.country}. ${contact(config, language)}`,
        ],
      },
      {
        title: "Data we process",
        bullets: [
          "Account data: email address, name, verification status, sessions, security settings, and consent history. Passwords are stored only as salted hashes.",
          "Profile data: name, age, sex, height, weight, language, goals, experience, equipment, diet, and injuries or limitations.",
          "Training data: programs, completed and skipped sessions, weights, repetitions, recovery feedback, and progression.",
          "Nutrition and measurements: meal descriptions, estimated calories and nutrients, bodyweight, and other measurements you choose to log.",
          "Coaching data: chat messages, permanent memories, and saved agent workspace files.",
          "Limited technical security data: server logs, timezone, version details, and hashed device information recorded with consent.",
          "Operational and product analytics: page views, registration and payment funnel steps, chat-message counts, completed features, AI token usage, and estimated cost. The analytics ledger does not contain chat text, meal contents, body measurements, IP addresses, or user-agent strings.",
          "Payments when enabled: plan, subscription status, and payment events. COACH does not store full card or bank details.",
        ],
      },
      {
        title: "Food photos",
        paragraphs: [
          "Photos are prepared on your device and sent to the configured AI provider for the active analysis. COACH does not retain the photo file in its database. Chat history may retain a text note stating that an image was used.",
        ],
      },
      {
        title: "Purposes and legal bases",
        bullets: [
          "Contract: authentication, programs, workout logging, coaching, and account features.",
          "Explicit consent: health-related information including injuries, body measurements, training, and nutrition.",
          "Legitimate interests: limited security, fraud prevention, and service reliability where those interests do not override your rights.",
          "Legitimate interests: privacy-minimal first-party analytics to understand registration, reliability, product use, and operating cost without advertising or third-party tracking.",
          "Legal obligation: records that applicable law requires the operator to retain.",
        ],
      },
      {
        title: "AI and processors",
        paragraphs: [
          "Chat text, relevant profile and training context, and images you actively attach may be sent to the AI provider configured by the operator. Better Auth runs inside COACH infrastructure and does not send account data to a separate identity provider. The email provider processes addresses and security messages. When payments are enabled, Stripe processes payment, invoice, and tax data. Database, server, and infrastructure providers process data only to operate the service. Current providers, processor agreements, and international transfer safeguards must be documented before public launch.",
        ],
      },
      {
        title: "Retention and sharing",
        paragraphs: [
          "Account data is kept while the account exists or as legally required. Privacy-minimal product and AI analytics events are automatically removed under the configured analytics retention period; their account ID is detached on account deletion. Verified payment accounting records may be retained separately for the period required by law. COACH does not sell personal information, use third-party advertising, or use an analytics cookie. Backups must rotate under the published retention schedule, and deleted accounts must disappear when that backup cycle expires.",
        ],
      },
      {
        title: "Your rights",
        paragraphs: [
          "You can download your data and delete your account in Settings. You may also request access, correction, restriction, portability, object to certain processing, or withdraw consent. Withdrawing health-data consent prevents COACH from providing its core service. You may complain to the Swedish Authority for Privacy Protection, IMY.",
        ],
      },
      {
        title: "Age and changes",
        paragraphs: [
          "COACH is for people aged 18 or older. Material policy changes require a fresh, active acknowledgement before the service can be used again.",
        ],
      },
    ] satisfies LegalSection[],
  };
}

export function termsContent(config: PublicLegalConfig, language: Language) {
  const sv = language === "sv";
  return sv
    ? {
        title: "Användarvillkor",
        intro:
          "Dessa villkor styr användningen av COACH. Genom att acceptera dem ingår du ett avtal med tjänstens operatör.",
        sections: [
          {
            title: "Tjänsten",
            paragraphs: [
              "COACH är ett AI-baserat verktyg för träningsplanering, träningslogg, kostuppskattning, motivation och uppföljning. Resultat och rekommendationer kan vara felaktiga och ska granskas med sunt förnuft.",
            ],
          },
          {
            title: "Behörighet och konto",
            paragraphs: [
              "Du måste vara minst 18 år, lämna korrekta uppgifter, skydda ditt lösenord och endast använda ditt eget konto. Meddela operatören om du misstänker obehörig åtkomst.",
            ],
          },
          {
            title: "Hälsa och eget ansvar",
            paragraphs: [
              "COACH ersätter inte läkare, fysioterapeut, dietist eller annan legitimerad vårdpersonal. Du ansvarar för att välja belastning, stoppa vid smärta och söka professionell hjälp vid skada, sjukdom, graviditet eller andra riskfaktorer.",
            ],
          },
          {
            title: "Tillåten användning",
            bullets: [
              "Försök inte komma åt andra konton, kringgå säkerhet eller överbelasta tjänsten.",
              "Ladda inte upp olagligt, skadligt eller integritetskränkande material.",
              "Använd inte tjänsten för diagnos, akutvård eller andra högriskbeslut.",
              "Automatisera inte massanrop eller återförsälj tjänsten utan skriftligt tillstånd.",
            ],
          },
          {
            title: "Dina uppgifter",
            paragraphs: [
              "Du behåller rättigheterna till innehåll du lämnar. Du ger operatören en begränsad rätt att behandla innehållet endast för att leverera, säkra och förbättra din användning av tjänsten enligt integritetspolicyn.",
            ],
          },
          {
            title: "Betalda planer",
            paragraphs: [
              "Om en betald plan erbjuds ska pris, valuta, faktureringsperiod, automatisk förnyelse och uppsägningsvillkor visas innan köp. Betalningar hanteras av den angivna betalningsleverantören. Tvingande konsumenträtt, inklusive eventuell ångerrätt, gäller alltid.",
            ],
          },
          {
            title: "Tillgänglighet och ansvar",
            paragraphs: [
              "Tjänsten tillhandahålls utan garanti om ständig tillgänglighet eller felfria AI-resultat. Inget i villkoren begränsar ansvar som inte får begränsas enligt tvingande lag. I övrigt ansvarar operatören inte för indirekta förluster eller beslut som en användare fattar utan rimlig kontroll.",
            ],
          },
          {
            title: "Avslut och lag",
            paragraphs: [
              `Du kan radera kontot när som helst. Operatören kan begränsa konton som bryter mot villkoren eller hotar säkerheten. Svensk lag gäller, med de konsumentskyddsregler som gäller där du bor. ${contact(config, language)}`,
            ],
          },
        ] satisfies LegalSection[],
      }
    : {
        title: "Terms of service",
        intro:
          "These terms govern use of COACH. By accepting them, you enter an agreement with the service operator.",
        sections: [
          {
            title: "The service",
            paragraphs: [
              "COACH is an AI-assisted tool for workout planning, training logs, nutrition estimates, motivation, and progress tracking. Outputs and recommendations can be wrong and must be reviewed using reasonable judgment.",
            ],
          },
          {
            title: "Eligibility and account",
            paragraphs: [
              "You must be at least 18, provide accurate information, protect your password, and use only your own account. Tell the operator if you suspect unauthorized access.",
            ],
          },
          {
            title: "Health and personal responsibility",
            paragraphs: [
              "COACH does not replace a doctor, physiotherapist, registered dietitian, or other qualified professional. You are responsible for choosing loads, stopping when you experience pain, and seeking professional help for injury, illness, pregnancy, or other risk factors.",
            ],
          },
          {
            title: "Acceptable use",
            bullets: [
              "Do not access other accounts, bypass security, or overload the service.",
              "Do not upload unlawful, harmful, or privacy-invasive material.",
              "Do not use the service for diagnosis, emergency care, or other high-risk decisions.",
              "Do not automate bulk requests or resell the service without written permission.",
            ],
          },
          {
            title: "Your data",
            paragraphs: [
              "You retain rights in content you provide. You grant the operator a limited right to process that content only to deliver, secure, and improve your use of the service as described in the privacy policy.",
            ],
          },
          {
            title: "Paid plans",
            paragraphs: [
              "If a paid plan is offered, its price, currency, billing period, automatic renewal, and cancellation terms will be shown before purchase. Payments are handled by the named payment provider. Mandatory consumer rights, including any applicable withdrawal right, always apply.",
            ],
          },
          {
            title: "Availability and liability",
            paragraphs: [
              "The service is provided without a promise of uninterrupted availability or error-free AI output. Nothing limits liability that cannot legally be limited. Otherwise, the operator is not responsible for indirect losses or decisions made without reasonable verification.",
            ],
          },
          {
            title: "Termination and law",
            paragraphs: [
              `You may delete your account at any time. The operator may restrict accounts that breach these terms or threaten security. Swedish law applies, subject to mandatory consumer rights where you live. ${contact(config, language)}`,
            ],
          },
        ] satisfies LegalSection[],
      };
}

export function healthContent(language: Language) {
  const sv = language === "sv";
  return sv
    ? {
        title: "Hälsa och säkerhet",
        intro:
          "COACH hjälper dig planera och följa träning, men är inte vård och kan inte bedöma din kropp som en människa på plats.",
        sections: [
          {
            title: "Inte medicinsk rådgivning",
            paragraphs: [
              "AI-coachen kan inte diagnostisera, behandla eller utesluta sjukdom eller skada. Kontakta kvalificerad vårdpersonal för medicinska frågor. Vid akut fara, kontakta lokala räddningstjänster omedelbart.",
            ],
          },
          {
            title: "Träna säkert",
            bullets: [
              "Stoppa en övning vid skarp, plötslig eller ovanlig smärta.",
              "Använd säkerhetsutrustning, passare och korrekt teknik när det behövs.",
              "Börja konservativt när din styrka, teknik eller utrustning är okänd.",
              "Träna inte mot medicinsk rådgivning eller när du är för sjuk, yr eller skadad.",
            ],
          },
          {
            title: "Uppskattningar",
            paragraphs: [
              "Kalorier, makron, mikronäringsämnen, belastningar och estimerade maxvärden är uppskattningar. Matfoto är särskilt osäkert eftersom portionsstorlek, ingredienser och tillagning inte kan mätas exakt från en bild.",
            ],
          },
          {
            title: "AI-begränsningar",
            paragraphs: [
              "Modellen kan missförstå, missa kontext eller ge ett självsäkert men felaktigt svar. Säkerhetsregler i koden begränsar vissa programändringar, men du måste fortfarande granska råden och rapportera smärta, skador och felaktiga antaganden.",
            ],
          },
        ] satisfies LegalSection[],
      }
    : {
        title: "Health and safety",
        intro:
          "COACH helps plan and track training, but it is not healthcare and cannot assess your body like a qualified person present with you.",
        sections: [
          {
            title: "Not medical advice",
            paragraphs: [
              "The AI coach cannot diagnose, treat, or rule out an illness or injury. Contact a qualified professional for medical questions. In an emergency, contact local emergency services immediately.",
            ],
          },
          {
            title: "Train safely",
            bullets: [
              "Stop an exercise if you feel sharp, sudden, or unusual pain.",
              "Use safety equipment, spotters, and appropriate technique when needed.",
              "Start conservatively when your strength, technique, or equipment is uncertain.",
              "Do not train against medical advice or while seriously ill, dizzy, or injured.",
            ],
          },
          {
            title: "Estimates",
            paragraphs: [
              "Calories, macros, micronutrients, training loads, and estimated maximums are estimates. Food-photo analysis is especially uncertain because portion size, ingredients, and preparation cannot be measured precisely from an image.",
            ],
          },
          {
            title: "AI limitations",
            paragraphs: [
              "The model can misunderstand, miss context, or provide a confident but incorrect answer. Code-level safety rules constrain some program changes, but you must still review guidance and report pain, injury, and incorrect assumptions.",
            ],
          },
        ] satisfies LegalSection[],
      };
}

export function trustContent(config: PublicLegalConfig, language: Language) {
  const sv = language === "sv";
  return sv
    ? {
        title: "Trygghet i COACH",
        intro:
          "En tydlig sammanfattning av hur COACH skyddar konton, använder AI och ger dig kontroll över dina uppgifter.",
        sections: [
          {
            title: "Kontogränser",
            bullets: [
              "Alla produktfrågor filtreras på det autentiserade konto-ID:t.",
              "Lösenord lagras som saltade scrypt-hashar, aldrig i klartext. Better Auth körs i COACH egen servermiljö.",
              "Råa sessionstokens ligger endast i säkra HTTP-only-cookies. Sessioner är tidsbegränsade, kan återkallas och lagras i den egna databasen.",
              "Känsliga ändringar har ursprungskontroll, storleksgränser och hastighetsbegränsning.",
            ],
          },
          {
            title: "Din kontroll",
            bullets: [
              "Exportera alla kontouppgifter som JSON.",
              "Radera permanent minne individuellt.",
              "Återställ coachens arbetsyta eller hela träningsprofilen.",
              "Radera kontot och tillhörande primärdata permanent.",
            ],
          },
          {
            title: "AI och bilder",
            paragraphs: [
              "AI får bara den kontokontext som behövs för den aktuella coachningen. Bildfiler sparas inte i COACH-databasen. COACH säljer inte data och visar inte tredjepartsannonser.",
            ],
          },
          {
            title: "Driftstatus",
            paragraphs: [
              `Den här miljön identifieras som ${config.appEnvironment}. Offentlig lansering är blockerad tills juridiska kontaktuppgifter, säkerhetskopior, återställningstest och övervakning är verifierade.`,
            ],
          },
        ] satisfies LegalSection[],
      }
    : {
        title: "Trust in COACH",
        intro:
          "A clear summary of how COACH protects accounts, uses AI, and gives you control over your information.",
        sections: [
          {
            title: "Account boundaries",
            bullets: [
              "Every product query is scoped to the authenticated account ID.",
              "Passwords are stored as salted scrypt hashes, never plaintext. Better Auth runs inside COACH infrastructure.",
              "Raw session tokens exist only in secure HTTP-only cookies. Sessions expire, can be revoked, and are stored in the app database.",
              "Sensitive mutations use origin checks, body limits, and rate limiting.",
            ],
          },
          {
            title: "Your control",
            bullets: [
              "Export all account information as JSON.",
              "Delete individual permanent memories.",
              "Reset the coach workspace or full training profile.",
              "Permanently delete the account and its primary data.",
            ],
          },
          {
            title: "AI and images",
            paragraphs: [
              "AI receives only the account context needed for the active coaching request. Image files are not stored in the COACH database. COACH does not sell data or show third-party advertising.",
            ],
          },
          {
            title: "Operational status",
            paragraphs: [
              `This environment identifies itself as ${config.appEnvironment}. Public launch is blocked until legal contact details, backups, restore testing, and monitoring have been verified.`,
            ],
          },
        ] satisfies LegalSection[],
      };
}
