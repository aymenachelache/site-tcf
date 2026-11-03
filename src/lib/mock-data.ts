export type Exam = {
  id: string;
  title: string;
  kind: "TCF Tout Public" | "Canada" | "IRN" | "Québec";
  sections: string[];
  price: number;
  totalMinutes: number;
  status: "publié" | "brouillon";
};

export type Question = {
  id: string;
  section: "CO" | "SL" | "CE";
  prompt: string;
  passage?: string;
  options: string[];
  points: number;
};

export const examCatalog: Exam[] = [
  {
    id: "exam-1",
    title: "Examen 1",
    kind: "TCF Tout Public",
    sections: ["CO", "SL", "CE"],
    price: 15000,
    totalMinutes: 75,
    status: "publié",
  },
  {
    id: "exam-2",
    title: "Examen 2",
    kind: "Canada",
    sections: ["CO", "CE"],
    price: 9000,
    totalMinutes: 70,
    status: "publié",
  },
  {
    id: "exam-3",
    title: "Examen 3",
    kind: "IRN",
    sections: ["CO", "SL", "CE", "EE"],
    price: 20000,
    totalMinutes: 120,
    status: "brouillon",
  },
];

export const questionBank: Question[] = [
  {
    id: "co-1",
    section: "CO",
    prompt: "Vous entendez: « Le train partira à 18 h 30. » Quelle information est donnée ?",
    options: ["Le train est annulé.", "Le train partira le soir.", "Le train partira à midi.", "Le train est en retard."],
    points: 10,
  },
  {
    id: "co-2",
    section: "CO",
    prompt: "Choisissez la bonne réponse selon l’audio : l’invité demande une information sur…",
    options: ["le prix", "l’adresse", "le horaire", "la date"],
    points: 12,
  },
  {
    id: "co-3",
    section: "CO",
    prompt: "Le locuteur explique qu’il faut…",
    options: ["aller tout de suite", "prendre un bus", "venir avant 9 h", "réserver en ligne"],
    points: 12,
  },
  {
    id: "sl-1",
    section: "SL",
    prompt: "Complétez : Si j’avais su, je ___ plus tôt.",
    options: ["viens", "viendrai", "serais venu", "viens de venir"],
    points: 15,
  },
  {
    id: "sl-2",
    section: "SL",
    prompt: "Choisissez la phrase correcte.",
    options: ["Il a été très content de son résultat.", "Il a été très content à son résultat.", "Il a été très content pour son résultat.", "Il a été très content sur son résultat."],
    points: 15,
  },
  {
    id: "ce-1",
    section: "CE",
    prompt: "Quel est le sens principal du texte ?",
    options: ["La ville va fermer son réseau de tramway.", "Une nouvelle ligne de métro est en projet.", "Les habitants demandent une baisse des tarifs.", "La ville annonce un grand festival culturel."],
    points: 20,
  },
  {
    id: "ce-2",
    section: "CE",
    prompt: "Le document met surtout l’accent sur…",
    options: ["la rapidité administrative", "la qualité de vie du quartier", "les conditions climatiques", "les risques liés à la circulation"],
    points: 18,
  },
];

export const paymentPlans = [
  { name: "Gratuit", duration: "1 examen CO+CE", price: 0, description: "Pour tester la plateforme" },
  { name: "Pack 3 examens", duration: "3 examens", price: 12000, description: "Idéal pour réviser en autonomie" },
  { name: "Pack 10 examens", duration: "10 examens", price: 35000, description: "Meilleur rapport qualité/prix" },
  { name: "Accès 30 jours illimité", duration: "30 jours", price: 50000, description: "Pour les révisions intensives" },
];
