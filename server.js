const express = require("express");
const Database = require('better-sqlite3'); // Ändrat från sqlite3
const bodyParser = require("body-parser");
const basicAuth = require("basic-auth");
const PDFDocument = require("pdfkit");
const cookieParser = require("cookie-parser");
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Middleware
app.set("trust proxy", true);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));

// VERCEL: Använd /tmp för databasen (skrivbar)
const isVercel = process.env.VERCEL === '1';
const dbPath = isVercel 
  ? '/tmp/database.db' 
  : path.join(__dirname, 'database.db');

console.log("Databas sökväg:", dbPath);

// Skapa databas med better-sqlite3
let db;
try {
  db = new Database(dbPath);
  console.log("Ansluten till databas");
  
  // Skapa tabell om den inte finns
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      terms_accepted BOOLEAN DEFAULT 0,
      affiliate_code TEXT DEFAULT 'main',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("Tabell redo");
} catch (err) {
  console.error("Databasfel:", err);
}

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

// POST /submit - uppdaterad för better-sqlite3
app.post("/submit", (req, res) => {
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
    const termsAcceptedValue = terms_accepted === "on" ? 1 : 0;
    if (!termsAcceptedValue) {
      return res.status(400).send("Du måste godkänna användarvillkoren.");
    }

    // Insert med better-sqlite3
    const stmt = db.prepare(`
      INSERT INTO claims 
        (namn, street, zip, city, email, phone, flightNumber, airline, bookingReference,
         departureAirport, arrivalAirport, flightDate, issue,
         signature, ip_address, terms_accepted, affiliate_code) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      namn, street, zip, city, email, phone, flightNumber, airline, bookingReference || null,
      departureAirport, arrivalAirport, flightDate, issue,
      signature, userIp, termsAcceptedValue, affiliateCode
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
app.get("/admin", authenticate, (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM claims ORDER BY created_at DESC").all();
    
    // Enkel HTML-visning (du kan utöka detta senare)
    let html = '<h1>Admin - Ärenden</h1>';
    html += `<p>Totalt: ${rows.length} ärenden</p>`;
    html += '<table border="1"><tr><th>ID</th><th>Namn</th><th>Email</th><th>Flygnr</th><th>Affiliate</th></tr>';
    
    rows.forEach(row => {
      html += `<tr>
        <td>${row.id}</td>
        <td>${row.namn || ''}</td>
        <td>${row.email || ''}</td>
        <td>${row.flightNumber || ''}</td>
        <td>${row.affiliate_code || 'main'}</td>
      </tr>`;
    });
    
    html += '</table>';
    res.send(html);
  } catch (err) {
    console.error("Admin-fel:", err);
    res.status(500).send("Databasfel: " + err.message);
  }
});

// Test route
app.get("/test", (req, res) => {
  res.send("API fungerar!");
});

// Exportera app för Vercel (VIKTIGT!)
module.exports = app;

// För lokal utveckling
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servern körs på http://localhost:${PORT}`);
  });
}