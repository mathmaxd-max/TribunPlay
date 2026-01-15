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
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Angaben gemäß § 5 TMG</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              Maximilian Leon Deffland<br />
              Gutenbergstraße 8A<br />
              37075 Göttingen<br />
              Deutschland
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Kontakt</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              Telefon: +49 176 578 37 110<br />
              E-Mail: maximilian-deffland@web.de
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Vertreten durch</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              Maximilian Leon Deffland
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</h2>
            <p style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              Maximilian Leon Deffland<br />
              Gutenbergstraße 8A<br />
              37075 Göttingen<br />
              Deutschland
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Streitschlichtung</h2>
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
            </p>
            <p style={{ marginBottom: '10px' }}>
              Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Haftung für Inhalte</h2>
            <p style={{ marginBottom: '10px' }}>
              Als Diensteanbieter sind wir gemäß § 7 Abs.1 TMG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.
            </p>
            <p style={{ marginBottom: '10px' }}>
              Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden von entsprechenden Rechtsverletzungen werden wir diese Inhalte umgehend entfernen.
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Haftung für Links</h2>
            <p style={{ marginBottom: '10px' }}>
              Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft. Rechtswidrige Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar.
            </p>
            <p style={{ marginBottom: '10px' }}>
              Eine permanente inhaltliche Kontrolle der verlinkten Seiten ist jedoch ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar. Bei Bekanntwerden von Rechtsverstößen werden wir derartige Links umgehend entfernen.
            </p>
          </section>

          <section style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#5f564a' }}>Urheberrecht</h2>
            <p style={{ marginBottom: '10px' }}>
              Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers. Downloads und Kopien dieser Seite sind nur für den privaten, nicht kommerziellen Gebrauch gestattet.
            </p>
            <p style={{ marginBottom: '10px' }}>
              Soweit die Inhalte auf dieser Seite nicht vom Betreiber erstellt wurden, werden die Urheberrechte Dritter beachtet. Insbesondere werden Inhalte Dritter als solche gekennzeichnet. Sollten Sie trotzdem auf eine Urheberrechtsverletzung aufmerksam werden, bitten wir um einen entsprechenden Hinweis. Bei Bekanntwerden von Rechtsverstößen werden wir derartige Inhalte umgehend entfernen.
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
