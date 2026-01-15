import { Link } from 'react-router-dom';

export default function Impressum() {
  return (
    <div style={{ maxWidth: '800px', margin: '50px auto', padding: '20px' }}>
      <div style={{ 
        background: 'white', 
        padding: '30px', 
        borderRadius: '8px', 
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)' 
      }}>
        <h1 style={{ marginBottom: '30px', textAlign: 'center' }}>Impressum</h1>
        
        <div style={{ marginBottom: '30px', lineHeight: '1.6', color: '#333' }}>
          <p style={{ marginBottom: '20px' }}>
            Angaben gemäß § 5 TMG
          </p>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV:</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              [Name / Firmenname]<br />
              [Straße Hausnummer]<br />
              [Postleitzahl Ort]<br />
              Deutschland
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Kontakt:</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              Telefon: [Telefonnummer]<br />
              E-Mail: [E-Mail-Adresse]
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Registereintrag:</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              Eintragung im Handelsregister.<br />
              Registergericht: [Amtsgericht Ort]<br />
              Registernummer: [Handelsregisternummer]
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Umsatzsteuer-ID:</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:<br />
              [USt-ID]
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Wirtschafts-ID:</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              Wirtschafts-Identifikationsnummer gemäß § 139c Abgabenordnung:<br />
              [Wirtschafts-ID]
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Aufsichtsbehörde:</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              [Name der Aufsichtsbehörde, falls zutreffend]
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Berufsbezeichnung und berufsrechtliche Regelungen:</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              [Berufsbezeichnung, falls zutreffend]<br />
              [Zuständige Kammer, falls zutreffend]<br />
              [Verliehen in: Land, falls zutreffend]
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Redaktionell verantwortlich:</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              [Name]<br />
              [Adresse]<br />
              [Postleitzahl Ort]
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>EU-Streitschlichtung:</h2>
            <p style={{ marginBottom: '10px' }}>
              Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: 
              <a 
                href="https://ec.europa.eu/consumers/odr/" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: '#007bff', textDecoration: 'none', marginLeft: '5px' }}
              >
                https://ec.europa.eu/consumers/odr/
              </a>
              <br />
              Unsere E-Mail-Adresse finden Sie oben im Impressum.
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Verbraucherstreitbeilegung / Universalschlichtungsstelle:</h2>
            <p style={{ marginBottom: '10px' }}>
              Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
            </p>
          </section>
        </div>

        <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #eee', textAlign: 'center' }}>
          <Link 
            to="/" 
            style={{ 
              color: '#007bff', 
              textDecoration: 'none',
              fontSize: '14px'
            }}
          >
            ← Zurück zur Startseite
          </Link>
        </div>
      </div>
    </div>
  );
}
