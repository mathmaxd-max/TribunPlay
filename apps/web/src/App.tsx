import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Game from './pages/Game';
import Datenschutz from './pages/Datenschutz';
import Disclaimer from './pages/Disclaimer';
import Impressum from './pages/Impressum';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/game/:code" element={<Game />} />
        <Route path="/datenschutz" element={<Datenschutz />} />
        <Route path="/disclaimer" element={<Disclaimer />} />
        <Route path="/impressum" element={<Impressum />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
