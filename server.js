const express = require("express");
const { Pool } = require('pg');
const bodyParser = require("body-parser");
const basicAuth = require("basic-auth");
const cookieParser = require("cookie-parser");
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.set("trust proxy", true);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Servera statiska filer från public-mappen
app.use(express.static(path.join(__dirname, 'public')));

// Test route
app.get("/test", (req, res) => {
  res.json({ message: "API fungerar!", status: "ok" });
});

// PostgreSQL anslutning
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Skapa tabell om den inte finns
pool.query(`
  CREATE TABLE IF NOT EXISTS claims (
    id SERIAL PRIMARY KEY,
    namn TEXT,
    street TEXT,
    zip TEXT,
    city TEXT,
    email TEXT,
    phone TEXT,
    flightnumber TEXT,
    airline TEXT,
    bookingreference TEXT,
    departureairport TEXT,
    arrivalairport TEXT,
    flightdate TEXT,
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

    // UPPDATERAD: Kolumnnamn matchar din tabell (namn, flightnumber, etc.)
    await pool.query(
      `INSERT INTO claims 
        (namn, street, zip, city, email, phone, flightnumber, airline, bookingreference,
         departureairport, arrivalairport, flightdate, issue,
         signature, ip_address, terms_accepted, affiliate_code) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [namn, street, zip, city, email, phone, flightNumber, airline, bookingReference || null,
       departureAirport, arrivalAirport, flightDate, issue,
       signature, userIp, termsAcceptedValue, affiliateCode]
    );

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tack för din ansökan</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #1a4b8c, #2a6bb0); color: white; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; color: #333; }
          h1 { color: #1a4b8c; }
          a { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #1a4b8c; color: white; text-decoration: none; border-radius: 5px; }
          a:hover { background: #0f3a6b; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Tack!</h1>
          <p>Ditt ärende har registrerats. Vi återkommer via e-post inom 24 timmar.</p>
          <a href="/">Gå tillbaka till startsidan</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Databasfel:", err);
    res.status(500).send("Något gick fel vid sparandet. Försök igen senare.");
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
          body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
          h1 { color: #1a4b8c; }
          .stats { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          table { border-collapse: collapse; width: 100%; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          th { background-color: #1a4b8c; color: white; font-weight: 600; }
          tr:nth-child(even) { background-color: #f9f9f9; }
          tr:hover { background-color: #f0f7ff; }
          .nav { margin: 20px 0; }
          .nav a { background: #1a4b8c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-right: 10px; display: inline-block; }
          .nav a:hover { background: #0f3a6b; }
        </style>
      </head>
      <body>
        <h1>FlightClaim Admin</h1>
        <div class="nav">
          <a href="/admin">🔄 Uppdatera</a>
          <a href="/">🏠 Tillbaka till sidan</a>
        </div>
        
        <div class="stats">
          <h2>Statistik</h2>
          <p><strong>Totalt antal ärenden:</strong> ${rows.length}</p>
          <p><strong>Senaste ärendet:</strong> ${rows.length > 0 ? new Date(rows[0].created_at).toLocaleString('sv-SE') : 'Inga ärenden än'}</p>
        </div>
        
        <h2>Alla ärenden</h2>
        <table>
          <tr>
            <th>ID</th>
            <th>Namn</th>
            <th>Email</th>
            <th>Telefon</th>
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
      // Formatera händelsetyp
      let issueText = '';
      if (row.issue === 'delay') issueText = 'Försening';
      else if (row.issue === 'cancelled') issueText = 'Inställt';
      else if (row.issue === 'denied') issueText = 'Nekad ombordstigning';
      else issueText = row.issue;

      html += `<tr>
        <td>${row.id}</td>
        <td>${row.namn || ''}</td>
        <td>${row.email || ''}</td>
        <td>${row.phone || ''}</td>
        <td>${row.flightnumber || ''}</td>
        <td>${row.airline || ''}</td>
        <td>${row.departureairport || ''}</td>
        <td>${row.arrivalairport || ''}</td>
        <td>${row.flightdate || ''}</td>
        <td>${issueText}</td>
        <td>${row.affiliate_code || 'main'}</td>
        <td>${row.created_at ? new Date(row.created_at).toLocaleString('sv-SE') : ''}</td>
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