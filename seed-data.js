// Dati iniziali da importare UNA volta (Impostazioni → Importa dati iniziali).
// paidBy: "me" = chi importa, "other" = il socio, "both" = pagato insieme (metà ciascuno).
// Le date indicate come 2026-07-01 sono da verificare: correggile nell'app dopo l'import.
// Contiene dati economici privati: dopo l'import puoi eliminare questo file dal repo.
export const SEED = {
  entries: [
    // Spese comuni pagate a metà
    { type: "expense", date: "2026-06-15", amount: 55600, category: "Acquisto immobile", description: "Prezzo di acquisto", paidBy: "both" },
    { type: "expense", date: "2026-06-15", amount: 3028, category: "Imposta di registro", description: "Imposta di registro acquisto", paidBy: "both" },
    { type: "expense", date: "2026-07-01", amount: 592.80, category: "Pratiche tecniche", description: "Architetto - anticipo sanatoria (30%)", note: "Preventivo 1.976 € + 4% cassa", paidBy: "both" },
    { type: "expense", date: "2026-07-01", amount: 250, category: "Pratiche tecniche", description: "Diritti di segreteria", paidBy: "both" },
    { type: "expense", date: "2026-07-01", amount: 634.40, category: "Pratiche tecniche", description: "Perizia ing. Giuntini", paidBy: "both" },

    // Spese anticipate da me
    { type: "expense", date: "2026-07-01", amount: 291.82, category: "Pratiche tecniche", description: "APE", paidBy: "me" },
    { type: "expense", date: "2026-07-01", amount: 71, category: "Altra spesa", description: "Associazione degli inquilini", paidBy: "me" },
    { type: "expense", date: "2026-07-01", amount: 79.30, category: "Volture/Allacci", description: "Pratica voltura gas", paidBy: "me" },
    { type: "expense", date: "2026-07-01", amount: 50.48, category: "Volture/Allacci", description: "Pratica voltura luce", paidBy: "me" },
    { type: "expense", date: "2026-08-17", amount: 35.08, category: "Volture/Allacci", description: "Voltura acqua (prima bolletta, quota proprietà)", note: "Bolletta 72,61 €: deposito 11,91 + sollecito 13,00 + consumi 18-30/06 10,17. Quota inquilino 37,53 già rimborsata", paidBy: "me" },
    { type: "maintenance", date: "2026-07-01", amount: 34, category: "Idraulico", description: "Rubinetto (Amazon)", paidBy: "me" },
    { type: "maintenance", date: "2026-07-01", amount: 26.90, category: "Caldaia/Clima", description: "Termostato", paidBy: "me" },
    { type: "maintenance", date: "2026-07-01", amount: 8, category: "Infissi", description: "Perno finestra", paidBy: "me" },

    // Incassi (tutti da me)
    { type: "income", date: "2026-07-01", amount: 1100, category: "Deposito cauzionale", description: "Deposito cauzionale (2 mensilità)", note: "Da restituire a fine contratto", paidBy: "me" },
    { type: "income", date: "2026-07-01", amount: 550, category: "Affitto", description: "Affitto luglio", paidBy: "me" },
    { type: "income", date: "2026-08-01", amount: 550, category: "Affitto", description: "Affitto agosto", paidBy: "me" },
    { type: "income", date: "2026-09-01", amount: 550, category: "Affitto", description: "Affitto settembre", paidBy: "me" },
    { type: "income", date: "2026-10-01", amount: 550, category: "Affitto", description: "Affitto ottobre", paidBy: "me" }
  ],
  scheduled: [
    { type: "expense", description: "Debito acqua lasciato dai vecchi proprietari", amount: 128.92, dueDate: "2026-10-31", recurrence: "none", category: "Utenze", paidBy: "me" },
    { type: "expense", description: "Saldo architetto sanatoria (verificare IVA)", amount: 1462.24, dueDate: "2026-11-30", recurrence: "none", category: "Pratiche tecniche", paidBy: "me" }
  ]
};
