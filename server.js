const express = require("express");
const { Pool } = require('pg');
const bodyParser = require("body-parser");
const basicAuth = require("basic-auth");
const cookieParser = require("cookie-parser");
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware - RÄTT ORDNING!
app.set("trust proxy", true);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// VIKTIGAST: Servera statiska filer FRÅN public-mappen
app.use(express.static(path.join(__dirname, 'public')));

// Test route (för att se om API:t fungerar)
app.get("/test", (req, res) => {
  res.json({ message: "API fungerar!", status: "ok" });
});

// PostgreSQL anslutning
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Skapa tabell om den inte finns (körs vid start)
pool.query(`
  CREATE TABLE IF NOT EXISTS claims (
    id SERIAL PRIMARY KEY,
    namn TEXT,
    street TEXT,
    zip TEXT,
    city TEXT,
    email TEXT,
    phone TEXT,
    flightNumber TEXT,
    airline TEXT,
    bookingReference TEXT,
    departureAirport TEXT,
    arrivalAirport TEXT,
    flightDate TEXT,
    issue TEXT,
    signature TEXT,
    ip_address TEXT,
    terms_accepted BOOLEAN DEFAULT false,
    affiliate_code TEXT DEFAULT 'main',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).catch(err => console.error("Tabellskapande misslyckades:", err));

// Basic Auth middleware
const authenticate = (req, res, next) => {
  const credentials = basicAuth(req);
  const validUser = process.env.ADMIN_USER || "admin";
  const validPass = process.env.ADMIN_PASS || "hemligt";

  if (!credentials || credentials.name !== validUser || credentials.pass !== validPass) {
    res.setHeader("WWW-Authenticate", "Basic realm=\"Admin\"");
    return res.status(401).send("Åtkomst nekad – du måste logga in.");
  }
  next();
};

// POST /submit
app.post("/submit", async (req, res) => {
  try {
    const {
      namn, street, zip, city, email, phone,
      flightNumber, airline, bookingReference,
      departureAirport, arrivalAirport, flightDate,
      issue, signature, terms_accepted
    } = req.body;
    const userIp = req.ip || req.connection.remoteAddress;
    
    let affiliateCode = 'main';
    if (req.cookies && req.cookies.affiliate_code) {
      affiliateCode = req.cookies.affiliate_code;
    }
    if (req.query.ref) {
      affiliateCode = req.query.ref;
      res.cookie('affiliate_code', req.query.ref, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
    }

    // Validering
    if (!namn || !street || !zip || !city || !email || !phone || !flightNumber || !airline ||
        !departureAirport || !arrivalAirport || !flightDate || !issue) {
      return res.status(400).send("Alla fält (förutom bokningsreferens) måste fyllas i.");
    }
    if (!signature) {
      return res.status(400).send("Signatur saknas.");
    }
    const termsAcceptedValue = terms_accepted === "on" ? true : false;
    if (!termsAcceptedValue) {
      return res.status(400).send("Du måste godkänna användarvillkoren.");
    }

    await pool.query(
      `INSERT INTO claims 
        (namn, street, zip, city, email, phone, flightNumber, airline, bookingReference,
         departureAirport, arrivalAirport, flightDate, issue,
         signature, ip_address, terms_accepted, affiliate_code) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [namn, street, zip, city, email, phone, flightNumber, airline, bookingReference || null,
       departureAirport, arrivalAirport, flightDate, issue,
       signature, userIp, termsAcceptedValue, affiliateCode]
    );

    res.send(`
      <h1>Tack!</h1>
      <p>Ditt ärende har registrerats. Vi återkommer via e-post.</p>
      <a href="/">Gå tillbaka</a>
    `);
  } catch (err) {
    console.error("Databasfel:", err);
    res.status(500).send("Något gick fel vid sparandet.");
  }
});

// Admin route
app.get("/admin", authenticate, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM claims ORDER BY created_at DESC");
    const rows = result.rows;
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Admin - FlightClaim</title>
        <style>
          body { font-family: Arial; margin: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #1a4b8c; color: white; }
        </style>
      </head>
      <body>
        <h1>Admin - Ärenden</h1>
        <p>Totalt: ${rows.length} ärenden</p>
        <table>
          <tr>
            <th>ID</th>
            <th>Namn</th>
            <th>Email</th>
            <th>Flygnr</th>
            <th>Flygbolag</th>
            <th>Från</th>
            <th>Till</th>
            <th>Datum</th>
            <th>Händelse</th>
            <th>Affiliate</th>
            <th>Skapad</th>
          </tr>
    `;
    
    rows.forEach(row => {
      html += `<tr>
        <td>${row.id}</td>
        <td>${row.namn || ''}</td>
        <td>${row.email || ''}</td>
        <td>${row.flightnumber || ''}</td>
        <td>${row.airline || ''}</td>
        <td>${row.departureairport || ''}</td>
        <td>${row.arrivalairport || ''}</td>
        <td>${row.flightdate || ''}</td>
        <td>${row.issue || ''}</td>
        <td>${row.affiliate_code || 'main'}</td>
        <td>${row.created_at || ''}</td>
      </tr>`;
    });
    
    html += '</table></body></html>';
    res.send(html);
  } catch (err) {
    console.error("Admin-fel:", err);
    res.status(500).send("Databasfel: " + err.message);
  }
});

// Exportera app för Vercel
module.exports = app;

// För lokal utveckling
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servern körs på http://localhost:${PORT}`);
  });
}