// Aggiornamento spese del 18/10/2026 — da applicare UNA volta (Impostazioni → Applica aggiornamento spese).
// Dopo l'applicazione puoi eliminare questo file dal repo.
// paidBy: "me" = chi applica (Martins), "other" = Fabio
export const UPDATE = {
  id: "2026-10-18",
  partnerName: "Fabio",
  // voci già importate da intestare a Martins (le aveva anticipate lui)
  setPaidByMe: ["Architetto - anticipo sanatoria (30%)", "Diritti di segreteria", "Perizia ing. Giuntini"],
  entries: [
    { type: "transfer", date: "2026-03-16", amount: 296.40, category: "Conguaglio", description: "Rimborso Fabio 50% fattura architetto", from: "other", to: "me" },
    { type: "transfer", date: "2026-06-18", amount: 375, category: "Conguaglio", description: "Rimborso Fabio ingegnere + diritti sanatoria", note: "50% sarebbe 442,20: mancano 67,20", from: "other", to: "me" },
    { type: "maintenance", date: "2026-07-01", amount: 8, category: "Infissi", description: "Chimico per perni finestra", paidBy: "me" },
    { type: "maintenance", date: "2026-07-01", amount: 250, category: "Altro", description: "Antenna", paidBy: "other" },
    { type: "expense", date: "2026-07-01", amount: 129.90, category: "Arredo", description: "Materasso (Amazon)", paidBy: "other" },
    { type: "maintenance", date: "2026-07-01", amount: 120, category: "Idraulico", description: "Idraulico - pompa", paidBy: "other" },
    { type: "maintenance", date: "2026-07-09", amount: 100, category: "Altro", description: "OBI - bagno", note: "Solo la parte per la casa", paidBy: "other" },
    { type: "maintenance", date: "2026-07-01", amount: 60, category: "Caldaia/Clima", description: "Idraulico - scaldabagno + diagnosi caldaia", paidBy: "other" },
    { type: "maintenance", date: "2026-07-01", amount: 40, category: "Imbiancatura", description: "Latta di pittura bianca", paidBy: "other" }
  ]
};
