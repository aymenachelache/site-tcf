type EmailMessage =
  | {
      kind: "payment-requested";
      to: string;
      planName: string;
      reference: string;
      amountDzd: number;
      paymentUrl: string;
      whatsappUrl: string | null;
      baridimobRip: string;
      accountName: string;
    }
  | {
      kind: "payment-request-admin";
      to: string;
      customerEmail: string;
      planName: string;
      reference: string;
      amountDzd: number;
      paymentUrl: string;
      whatsappUrl: string | null;
    }
  | {
      kind: "access-activated";
      to: string;
      planName: string;
      reference?: string;
      amountDzd?: number;
      creditsRemaining: number | null;
      includedExamCount: number;
      expiresAt: string | null;
    }
  | { kind: "payment-rejected"; to: string; planName: string; reference: string; reason: string }
  | { kind: "access-expiring"; to: string; firstName: string; planName: string; expiresAt: string };

function messageContent(message: EmailMessage): { subject: string; text: string } {
  switch (message.kind) {
    case "payment-requested":
      return {
        subject: "Votre demande de paiement TCF a été créée",
        text: `Bonjour,\n\nVotre demande pour le forfait ${message.planName} a bien été créée.\nMontant : ${new Intl.NumberFormat("fr-DZ").format(message.amountDzd)} DA.\nRéférence : ${message.reference}.\nRIP BaridiMob : ${message.baridimobRip || "à confirmer sur la page de paiement"}.\nTitulaire : ${message.accountName || "à confirmer sur la page de paiement"}.\n\nEffectuez le virement, puis envoyez votre reçu sur WhatsApp en indiquant la référence. Retrouvez les étapes ici : ${message.paymentUrl}${message.whatsappUrl ? `\nLien WhatsApp : ${message.whatsappUrl}` : ""}\n\nL’équipe TCF Simulation`,
      };
    case "payment-request-admin":
      return {
        subject: `Nouvelle demande de paiement TCF · ${message.reference}`,
        text: `Bonjour,\n\nUne nouvelle demande de paiement a été créée.\nCandidat : ${message.customerEmail}\nOffre : ${message.planName}\nMontant : ${new Intl.NumberFormat("fr-DZ").format(message.amountDzd)} DA\nRéférence : ${message.reference}\n\nConsulter les instructions de paiement : ${message.paymentUrl}${message.whatsappUrl ? `\nLien WhatsApp prérempli : ${message.whatsappUrl}` : ""}\n\nTCF Simulation`,
      };
    case "access-activated":
      return {
        subject: "Votre accès TCF est activé",
        text: `Bonjour,\n\nVotre accès au forfait ${message.planName} est activé.${message.reference ? `\nRéférence : ${message.reference}.` : ""}${message.amountDzd === undefined ? "" : `\nMontant : ${new Intl.NumberFormat("fr-DZ").format(message.amountDzd)} DA.`}\nCrédits restants : ${message.creditsRemaining ?? "non applicable"}.\nExamens inclus : ${message.includedExamCount}.\nExpiration : ${message.expiresAt ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(message.expiresAt)) : "sans date d’expiration"}.\n\nVous pouvez retrouver vos accès dans votre tableau de bord.\n\nL’équipe TCF Simulation`,
      };
    case "payment-rejected":
      return {
        subject: "Mise à jour de votre demande de paiement TCF",
        text: `Bonjour,\n\nVotre demande pour le forfait ${message.planName} (référence ${message.reference}) a été refusée.\nMotif : ${message.reason}\n\nSi vous avez besoin d’aide, contactez notre équipe.\n\nL’équipe TCF Simulation`,
      };
    case "access-expiring":
      return {
        subject: "Votre accès TCF expire dans 3 jours",
        text: `Bonjour${message.firstName ? ` ${message.firstName}` : ""},\n\nVotre accès ${message.planName} expirera le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(message.expiresAt))}.\n\nPensez à terminer vos simulations avant cette date ou à renouveler votre accès.\n\nL’équipe TCF Simulation`,
      };
  }
}

export async function sendTransactionalEmail(message: EmailMessage): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !sender) {
    const error = "RESEND_API_KEY ou RESEND_FROM_EMAIL n’est pas configuré.";
    console.error(`Transactional email (${message.kind}) was not sent:`, error);
    return { sent: false, error };
  }

  try {
    const content = messageContent(message);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender, to: [message.to], ...content }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const error = `Resend a répondu ${response.status}: ${await response.text()}`;
      console.error(`Transactional email (${message.kind}) failed:`, error);
      return { sent: false, error };
    }
    return { sent: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Erreur inconnue.";
    console.error(`Transactional email (${message.kind}) failed:`, detail);
    return { sent: false, error: detail };
  }
}
