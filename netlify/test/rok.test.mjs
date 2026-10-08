import test from "node:test";
import assert from "node:assert/strict";
import { izracunajPodsetnike, plusMeseci, parseDatum, isoDatum, danasBeograd, sastaviEmail } from "../lib/rok.mjs";

const D = (s) => parseDatum(s);
const base = {
  objekti: [{ id: "o1", naziv: "SIM", adresa: "Dunavska 83", kontakt_osoba: "Dragana", telefon: "064" }],
  poslato: [],
};
const inst = (id, interval = 6) => ({ id, objekat_id: "o1", tip: "PP aparati", oznaka: "7 aparata", interval_meseci: interval });
const serv = (iid, datum, vrsta = "Redovna kontrola") => ({ instalacija_id: iid, datum, vrsta });

test("plusMeseci čuva kraj meseca", () => {
  assert.equal(isoDatum(plusMeseci(D("2026-08-31"), 6)), "2027-02-28");
  assert.equal(isoDatum(plusMeseci(D("2026-07-28"), 6)), "2027-01-28");
});

test("prag 30 i 7 dana", () => {
  // rok = 2027-01-28
  const mk = (danas) => izracunajPodsetnike({ ...base, instalacije: [inst("i1")], servisi: [serv("i1", "2026-07-28")], danas: D(danas) });
  assert.equal(mk("2026-12-01").length, 0);                // 58 dana
  assert.deepEqual(mk("2026-12-29").map((s) => s.prag_dana), [30]); // 30 dana
  assert.deepEqual(mk("2027-01-22").map((s) => s.prag_dana), [7]);  // 6 dana
});

test("granice zona", () => {
  const mk = (danas) => izracunajPodsetnike({ ...base, instalacije: [inst("i1")], servisi: [serv("i1", "2026-07-28")], danas: D(danas) });
  assert.equal(mk("2027-01-21")[0].prag_dana, 7);  // 7 dana
  assert.equal(mk("2027-01-20")[0].prag_dana, 30); // 8 dana
  assert.equal(mk("2027-01-28")[0].prag_dana, 7);  // danas je rok
  assert.equal(mk("2027-01-29").length, 0);        // kasni -> ne šalje se
});

test("nema duplikata za isti prag i rok", () => {
  const danas = D("2026-12-29");
  const poslato = [{ instalacija_id: "i1", prag_dana: 30, rok_datum: "2027-01-28" }];
  assert.equal(izracunajPodsetnike({ ...base, poslato, instalacije: [inst("i1")], servisi: [serv("i1", "2026-07-28")], danas }).length, 0);
  // posle novog servisa rok se pomera => novi ciklus se ponovo šalje
  const novi = izracunajPodsetnike({ ...base, poslato, instalacije: [inst("i1")],
    servisi: [serv("i1", "2026-07-28"), serv("i1", "2026-12-20")], danas: D("2027-05-25") });
  assert.equal(novi.length, 1);
});

test("popravka ne resetuje rok, instalacija bez kontrole se preskače", () => {
  const danas = D("2026-12-29");
  const r = izracunajPodsetnike({ ...base, instalacije: [inst("i1"), inst("i2")],
    servisi: [serv("i1", "2026-07-28"), serv("i1", "2026-12-20", "Popravka")], danas });
  assert.equal(r.length, 1);
  assert.equal(r[0].instalacija_id, "i1");
});

test("danasBeograd i email", () => {
  assert.equal(isoDatum(danasBeograd(new Date("2026-12-31T23:30:00Z"))), "2027-01-01"); // CET = UTC+1
  const s = izracunajPodsetnike({ ...base, instalacije: [inst("i1")], servisi: [serv("i1", "2026-07-28")], danas: D("2027-01-25") });
  const m = sastaviEmail(s, "https://app.vatrospremdoo.rs");
  assert.match(m.subject, /1 instalacija/);
  assert.match(m.text, /SIM/);
  assert.match(m.html, /Dunavska 83/);
});
