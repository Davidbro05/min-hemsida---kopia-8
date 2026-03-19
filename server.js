const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const basicAuth = require("basic-auth");
const PDFDocument = require("pdfkit");
const cookieParser = require("cookie-parser");
require('dotenv').config();

const app = express();
const db = new sqlite3.Database("./database.db");

app.set("trust proxy", true);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));

// Skapa tabell med affiliate_code
db.run(`
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

// Lägg till eventuella saknade kolumner
const addColumnIfNotExists = (column, type) => {
  db.run(`ALTER TABLE claims ADD COLUMN ${column} ${type}`, (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error(`Kunde inte lägga till ${column}:`, err);
    }
  });
};

addColumnIfNotExists("street", "TEXT");
addColumnIfNotExists("zip", "TEXT");
addColumnIfNotExists("city", "TEXT");
addColumnIfNotExists("phone", "TEXT");
addColumnIfNotExists("bookingReference", "TEXT");
addColumnIfNotExists("departureAirport", "TEXT");
addColumnIfNotExists("arrivalAirport", "TEXT");
addColumnIfNotExists("signature", "TEXT");
addColumnIfNotExists("ip_address", "TEXT");
addColumnIfNotExists("terms_accepted", "BOOLEAN DEFAULT 0");
addColumnIfNotExists("affiliate_code", "TEXT DEFAULT 'main'");

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

// POST /submit - med affiliate tracking
app.post("/submit", (req, res) => {
  const {
    namn, street, zip, city, email, phone,
    flightNumber, airline, bookingReference,
    departureAirport, arrivalAirport, flightDate,
    issue, signature, terms_accepted
  } = req.body;
  const userIp = req.ip || req.connection.remoteAddress;
  
  // Hämta affiliate_code från cookie eller query-parameter
  let affiliateCode = 'main';
  
  if (req.cookies && req.cookies.affiliate_code) {
    affiliateCode = req.cookies.affiliate_code;
  }
  
  if (req.query.ref) {
    affiliateCode = req.query.ref;
    res.cookie('affiliate_code', req.query.ref, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
  }

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

  db.run(
    `INSERT INTO claims 
      (namn, street, zip, city, email, phone, flightNumber, airline, bookingReference,
       departureAirport, arrivalAirport, flightDate, issue,
       signature, ip_address, terms_accepted, affiliate_code) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      namn, street, zip, city, email, phone, flightNumber, airline, bookingReference || null,
      departureAirport, arrivalAirport, flightDate, issue,
      signature, userIp, termsAcceptedValue, affiliateCode
    ],
    function (err) {
      if (err) {
        console.error("Databasfel:", err);
        return res.status(500).send("Något gick fel vid sparandet.");
      }
      res.send(`
        <h1>Tack!</h1>
        <p>Ditt ärende har registrerats. Vi återkommer via e-post.</p>
        <a href="/">Gå tillbaka</a>
      `);
    }
  );
});

// ADMIN-VY - med affiliate-kod kolumn
app.get("/admin", authenticate, (req, res) => {
  db.all("SELECT * FROM claims ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Databasfel");
    }

    const escapeHtml = (unsafe) => {
      if (!unsafe) return '';
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Admin - Claims</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: middle; }
          th { background-color: #1a4b8c; color: white; }
          tr:nth-child(even) { background-color: #f2f2f2; }
          img { max-width: 200px; max-height: 100px; border: 1px solid #ccc; background: #fff; }
          .no-signature { color: #999; font-style: italic; }
          .accepted-yes { color: green; font-weight: bold; }
          .accepted-no { color: red; }
          .pdf-link { background: #2a5298; color: white; padding: 4px 8px; text-decoration: none; border-radius: 4px; font-size: 12px; }
          .pdf-link:hover { background: #1e3c72; }
          .delete-btn { background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
          .delete-btn:hover { background: #c82333; }
          .admin-nav { margin-bottom: 20px; padding: 10px; background: #f5f5f5; border-radius: 5px; }
          .admin-nav a { margin-right: 20px; color: #1a4b8c; text-decoration: none; font-weight: 500; }
          .admin-nav a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="admin-nav">
          <a href="/admin">📋 Alla ärenden</a>
          <a href="/admin/affiliates">📊 Affiliate-statistik</a>
        </div>
        
        <h1>Alla inskickade ersättningsanspråk</h1>
        <table>
          <tr>
            <th>ID</th>
            <th>Namn</th>
            <th>Gata</th>
            <th>Postnr</th>
            <th>Ort</th>
            <th>Email</th>
            <th>Telefon</th>
            <th>Flygnr</th>
            <th>Flygbolag</th>
            <th>PNR</th>
            <th>Från</th>
            <th>Till</th>
            <th>Datum</th>
            <th>Händelse</th>
            <th>Signatur</th>
            <th>Godkänt</th>
            <th>IP</th>
            <th>Skapad</th>
            <th>Affiliate</th>
            <th>Fullmakt</th>
            <th>Ta bort</th>
          </tr>
    `;

    rows.forEach(row => {
      const signatureImg = row.signature 
        ? `<img src="${escapeHtml(row.signature)}" alt="Signatur">`
        : '<span class="no-signature">Ingen signatur</span>';

      const termsAccepted = row.terms_accepted 
        ? '<span class="accepted-yes">Ja</span>' 
        : '<span class="accepted-no">Nej</span>';

      const pdfLink = row.signature 
        ? `<a href="/fullmakt/${row.id}" class="pdf-link" target="_blank">📄 Ladda ner PDF</a>`
        : '—';

      let issueText = '';
      if (row.issue === 'delay') issueText = 'Försening';
      else if (row.issue === 'cancelled') issueText = 'Inställt';
      else if (row.issue === 'denied') issueText = 'Nekad ombordstigning';
      else issueText = row.issue;

      html += `
        <tr>
          <td>${row.id}</td>
          <td>${escapeHtml(row.namn)}</td>
          <td>${escapeHtml(row.street) || ''}</td>
          <td>${escapeHtml(row.zip) || ''}</td>
          <td>${escapeHtml(row.city) || ''}</td>
          <td>${escapeHtml(row.email)}</td>
          <td>${escapeHtml(row.phone)}</td>
          <td>${escapeHtml(row.flightNumber)}</td>
          <td>${escapeHtml(row.airline)}</td>
          <td>${escapeHtml(row.bookingReference) || '—'}</td>
          <td>${escapeHtml(row.departureAirport)}</td>
          <td>${escapeHtml(row.arrivalAirport)}</td>
          <td>${escapeHtml(row.flightDate)}</td>
          <td>${escapeHtml(issueText)}</td>
          <td>${signatureImg}</td>
          <td>${termsAccepted}</td>
          <td>${escapeHtml(row.ip_address) || 'N/A'}</td>
          <td>${row.created_at}</td>
          <td>${escapeHtml(row.affiliate_code) || 'main'}</td>
          <td>${pdfLink}</td>
          <td>
            <form action="/admin/delete/${row.id}" method="POST" onsubmit="return confirm('Är du säker på att du vill ta bort detta ärende?');">
              <button type="submit" class="delete-btn">Ta bort</button>
            </form>
          </td>
        </tr>
      `;
    });

    html += `
        </table>
      </body>
      </html>
    `;

    res.send(html);
  });
});

// Ta bort ärende
app.post("/admin/delete/:id", authenticate, (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM claims WHERE id = ?", id, function(err) {
    if (err) {
      console.error("Fel vid borttagning:", err);
      return res.status(500).send("Kunde inte ta bort ärendet.");
    }
    res.redirect("/admin");
  });
});

// Affiliate-statistik
app.get("/admin/affiliates", authenticate, (req, res) => {
  db.all(`
    SELECT 
      affiliate_code, 
      COUNT(*) as total_claims,
      SUM(CASE WHEN created_at > datetime('now', '-30 days') THEN 1 ELSE 0 END) as last_30_days
    FROM claims 
    GROUP BY affiliate_code
    ORDER BY total_claims DESC
  `, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Databasfel");
    }

    const escapeHtml = (unsafe) => {
      if (!unsafe) return '';
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Affiliates - FlightClaim</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #1a4b8c; }
          table { border-collapse: collapse; width: 100%; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          th { background-color: #1a4b8c; color: white; }
          tr:nth-child(even) { background-color: #f2f2f2; }
          .main-row { background-color: #e8f4f8; font-weight: bold; }
          .code-box { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
          input { padding: 8px; width: 300px; border: 1px solid #ccc; border-radius: 4px; }
          button { padding: 8px 15px; background: #1a4b8c; color: white; border: none; border-radius: 4px; cursor: pointer; }
          button:hover { background: #0f3a6b; }
          .nav { margin-bottom: 20px; padding: 10px; background: #f5f5f5; border-radius: 5px; }
          .nav a { color: #1a4b8c; text-decoration: none; margin-right: 15px; }
          .nav a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="nav">
          <a href="/admin">← Tillbaka till alla ärenden</a>
          <a href="/admin/affiliates">🔄 Uppdatera</a>
        </div>
        
        <h1>Affiliate-program</h1>
        
        <div class="code-box">
          <h3>Skapa ny affiliate-länk</h3>
          <p>Ange ett unikt namn för kreatören (t.ex. "youtuber123" eller "bloggaren"):</p>
          <input type="text" id="affiliateName" placeholder="t.ex. johansblogg">
          <button onclick="generateLink()">Generera länk</button>
          <p id="generatedLink" style="margin-top: 10px; display: none;">
            Din affiliate-länk: <br>
            <input type="text" id="linkOutput" readonly style="width: 100%; margin-top: 5px;">
            <button onclick="copyLink()">Kopiera länk</button>
          </p>
        </div>

        <h2>Statistik per affiliate</h2>
        <table>
          <tr>
            <th>Affiliate-kod</th>
            <th>Totalt antal ärenden</th>
            <th>Senaste 30 dagarna</th>
            <th>Andel</th>
            <th>Länk</th>
          </tr>
    `;

    let total = 0;
    rows.forEach(row => {
      if (row.affiliate_code !== 'main') total += row.total_claims;
    });

    rows.forEach(row => {
      const isMain = row.affiliate_code === 'main';
      const rowClass = isMain ? 'main-row' : '';
      const percentage = !isMain && total > 0 ? Math.round((row.total_claims / total) * 100) : 0;
      
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const affiliateLink = isMain ? '—' : `${baseUrl}/?ref=${encodeURIComponent(row.affiliate_code)}`;

      html += `
        <tr class="${rowClass}">
          <td><strong>${escapeHtml(row.affiliate_code)}</strong></td>
          <td>${row.total_claims}</td>
          <td>${row.last_30_days || 0}</td>
          <td>${!isMain ? percentage + '%' : '—'}</td>
          <td>${!isMain ? `<a href="${affiliateLink}" target="_blank">🔗 ${escapeHtml(row.affiliate_code)}-länk</a>` : '—'}</td>
        </tr>
      `;
    });

    html += `
        </table>
        
        <script>
          function generateLink() {
            const name = document.getElementById('affiliateName').value.trim();
            if (!name) {
              alert('Ange ett namn för affiliate-länken');
              return;
            }
            // Ta bort konstiga tecken och mellanslag
            const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanName !== name.toLowerCase()) {
              alert('Endast bokstäver och siffror är tillåtna. Namnet blev: ' + cleanName);
            }
            const baseUrl = window.location.origin;
            const link = baseUrl + '/?ref=' + encodeURIComponent(cleanName);
            document.getElementById('linkOutput').value = link;
            document.getElementById('generatedLink').style.display = 'block';
          }
          
          function copyLink() {
            const linkInput = document.getElementById('linkOutput');
            linkInput.select();
            document.execCommand('copy');
            alert('Länken har kopierats till urklipp!');
          }
        </script>
      </body>
      </html>
    `;

    res.send(html);
  });
});

// PDF-fullmakt
app.get("/fullmakt/:id", authenticate, (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM claims WHERE id = ?", [id], (err, row) => {
    if (err || !row) {
      console.error(err);
      return res.status(404).send("Ärendet hittades inte.");
    }

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=power_of_attorney_${row.id}.pdf`);
    doc.pipe(res);

    const companyName = process.env.COMPANY_NAME || "FlightClaim AB";
    const companyReg = process.env.COMPANY_REG || "XXXXXX-XXXX";
    const companyAddress = process.env.COMPANY_ADDRESS || "Exempelgatan 1, 123 45 Stockholm";

    const getDisruptionText = (issue) => {
      const delayChecked = issue === 'delay' ? '☒' : '☐';
      const cancelledChecked = issue === 'cancelled' ? '☒' : '☐';
      const deniedChecked = issue === 'denied' ? '☒' : '☐';
      return `${delayChecked} Flight Delay\n${cancelledChecked} Flight Cancellation\n${deniedChecked} Denied Boarding`;
    };

    doc.fontSize(20).text('POWER OF ATTORNEY', { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(12).text(`I hereby authorize ${companyName}, company registration number ${companyReg}, with registered address ${companyAddress}, to represent me in my claim for compensation against the operating airline in accordance with EU Regulation 261/2004.`);
    doc.moveDown();

    doc.text(`This authorization grants ${companyName} the right to act on my behalf in all matters relating to my claim for compensation, including but not limited to:`);
    doc.moveDown(0.5);
    doc.text('• contacting the airline and other relevant parties');
    doc.text('• submitting and managing compensation claims');
    doc.text('• negotiating settlements');
    doc.text('• receiving correspondence related to the claim');
    doc.text('• receiving compensation payments on my behalf');
    doc.text('• initiating legal proceedings if necessary to enforce my rights');
    doc.moveDown();

    doc.text(`I understand that ${companyName} may charge a service fee according to the agreed terms and conditions.`);
    doc.moveDown(2);

    doc.fontSize(14).text('Passenger Information', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Full Name: ${row.namn}`);
    doc.text(`Address: ${row.street}, ${row.zip} ${row.city}`);
    doc.text(`Email Address: ${row.email}`);
    doc.text(`Phone Number: ${row.phone}`);
    doc.moveDown(2);

    doc.fontSize(14).text('Flight Information', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Airline: ${row.airline}`);
    doc.text(`Flight Number: ${row.flightNumber}`);
    doc.text(`Booking Reference (PNR): ${row.bookingReference || ''}`);
    doc.text(`Departure Airport: ${row.departureAirport}`);
    doc.text(`Arrival Airport: ${row.arrivalAirport}`);
    doc.text(`Flight Date: ${row.flightDate}`);
    doc.text('Type of Disruption:');
    doc.text(getDisruptionText(row.issue), { indent: 20 });
    doc.moveDown(2);

    doc.fontSize(14).text('Authorization', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`By signing this document, I confirm that the information provided above is correct and that I authorize ${companyName} to represent me in my claim against the airline.`);
    doc.moveDown();
    doc.text('This authorization remains valid until the claim has been resolved or until it is revoked in writing.');
    doc.moveDown(2);

    doc.fontSize(14).text('Signature', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Passenger Name: ${row.namn}`);
    doc.text(`Place: ${row.city}`);
    doc.text(`Date: ${new Date().toLocaleDateString('en-US')}`);
    doc.moveDown();
    doc.text('Signature:');

    if (row.signature) {
      try {
        const base64Data = row.signature.split(',')[1];
        const imageBuffer = Buffer.from(base64Data, 'base64');
        doc.moveDown(0.5);
        doc.image(imageBuffer, { width: 200, height: 100 });
      } catch (e) {
        console.error("Kunde inte bädda in signatur:", e);
        doc.text('(Signature could not be loaded)', { color: 'red' });
      }
    } else {
      doc.text('(No signature)', { color: 'gray' });
    }

    doc.end();
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servern körs på http://localhost:${PORT}`);
});