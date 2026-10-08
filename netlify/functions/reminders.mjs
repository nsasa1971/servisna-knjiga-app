import { pokreni } from "../lib/podsetnici.mjs";

/* Netlify Scheduled Function — jednom dnevno u 06:00 UTC (07:00/08:00 u Beogradu). */
export default async () => {
  const rez = await pokreni();
  console.log("Podsetnici:", JSON.stringify(rez));
};

export const config = { schedule: "0 6 * * *" };
