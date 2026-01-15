import { Link } from 'react-router-dom';

export default function Datenschutz() {
  return (
    <div style={{ maxWidth: '800px', margin: '50px auto', padding: '20px' }}>
      <div style={{ 
        background: 'white', 
        padding: '30px', 
        borderRadius: '8px', 
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)' 
      }}>
        <h1 style={{ marginBottom: '30px', textAlign: 'center' }}>Datenschutzerklärung</h1>
        
        <div style={{ marginBottom: '30px', lineHeight: '1.6', color: '#333' }}>
          <p style={{ marginBottom: '20px', fontSize: '14px', color: '#666' }}>
            <strong>Stand:</strong> {new Date().toLocaleDateString('de-DE')}
          </p>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>1. Verantwortlicher</h2>
            <p style={{ marginBottom: '10px' }}>
              Verantwortlich für die Datenverarbeitung auf dieser Website ist:
            </p>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              Maximilian Leon Deffland<br />
              Gutenbergstraße 8A<br />
              37075 Göttingen<br />
              Deutschland<br />
              E-Mail: maximilian-deffland@web.de<br />
              Telefon: +49 176 578 37 110
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>2. Arten der verarbeiteten Daten</h2>
            <p style={{ marginBottom: '10px' }}>
              Bei der Nutzung dieser Website können folgende Daten verarbeitet werden:
            </p>
            <ul style={{ marginLeft: '20px', marginBottom: '10px' }}>
              <li style={{ marginBottom: '8px' }}>Kontaktdaten (Name, E-Mail-Adresse, falls angegeben)</li>
              <li style={{ marginBottom: '8px' }}>Nutzungsdaten (besuchte Seiten, Zugriffszeiten, IP-Adressen)</li>
              <li style={{ marginBottom: '8px' }}>Technische Daten (Browsertyp, Betriebssystem, Geräteinformationen)</li>
              <li style={{ marginBottom: '8px' }}>Spieldaten (Spielcodes, Spielstände, Chat-Nachrichten)</li>
            </ul>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>3. Zwecke und Rechtsgrundlagen der Verarbeitung</h2>
            <p style={{ marginBottom: '10px' }}>
              Die Verarbeitung Ihrer Daten erfolgt zu folgenden Zwecken:
            </p>
            <ul style={{ marginLeft: '20px', marginBottom: '10px' }}>
              <li style={{ marginBottom: '8px' }}>
                <strong>Bereitstellung der Website:</strong> Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse)
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Durchführung von Spielen:</strong> Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Sicherheit und Betrugsprävention:</strong> Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse)
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>4. Speicherdauer</h2>
            <p style={{ marginBottom: '10px' }}>
              Ihre Daten werden nur so lange gespeichert, wie es für die jeweiligen Zwecke erforderlich ist oder gesetzliche Aufbewahrungspflichten bestehen. Spieldaten werden nach Beendigung des Spiels gelöscht, sofern keine gesetzlichen Aufbewahrungspflichten bestehen.
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>5. Ihre Rechte</h2>
            <p style={{ marginBottom: '10px' }}>
              Sie haben folgende Rechte bezüglich Ihrer personenbezogenen Daten:
            </p>
            <ul style={{ marginLeft: '20px', marginBottom: '10px' }}>
              <li style={{ marginBottom: '8px' }}>Auskunftsrecht (Art. 15 DSGVO)</li>
              <li style={{ marginBottom: '8px' }}>Recht auf Berichtigung (Art. 16 DSGVO)</li>
              <li style={{ marginBottom: '8px' }}>Recht auf Löschung (Art. 17 DSGVO)</li>
              <li style={{ marginBottom: '8px' }}>Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
              <li style={{ marginBottom: '8px' }}>Recht auf Datenübertragbarkeit (Art. 20 DSGVO)</li>
              <li style={{ marginBottom: '8px' }}>Widerspruchsrecht (Art. 21 DSGVO)</li>
              <li style={{ marginBottom: '8px' }}>Recht zur Beschwerde bei einer Aufsichtsbehörde (Art. 77 DSGVO)</li>
            </ul>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>6. Kontakt</h2>
            <p style={{ marginBottom: '10px' }}>
              Bei Fragen zur Datenverarbeitung können Sie sich jederzeit an uns wenden:
            </p>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              E-Mail: maximilian-deffland@web.de<br />
              Telefon: +49 176 578 37 110
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
