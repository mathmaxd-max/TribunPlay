import { useEffect } from "react";
import { matchPath, useLocation } from "react-router-dom";

const APP_NAME = "Tribun Play";

const STATIC_ROUTE_TITLES: Record<string, string> = {
  "/": "Choose Identity",
  "/login": "Log in",
  "/hub": "Hub",
  "/play": "Play with a Friend",
  "/history": "Game History",
  "/setup-explorer": "Setup Explorer",
  "/board-canvas": "Board Canvas",
  "/clock": "Table Clock",
  "/settings": "Settings",
  "/tutorial": "Tutorial",
  "/datenschutz": "Datenschutz",
  "/disclaimer": "Disclaimer",
  "/impressum": "Impressum",
};

export function DocumentHead() {
  const location = useLocation();

  useEffect(() => {
    const review = matchPath("/review/:gameId", location.pathname);
    if (review) {
      document.title = `Review - ${APP_NAME}`;
      return;
    }
    const game = matchPath("/game/:code", location.pathname);
    if (game?.params.code) {
      document.title = `${game.params.code} - ${APP_NAME}`;
      return;
    }
    const tutorialChapter = matchPath("/tutorial/:chapterId", location.pathname);
    if (tutorialChapter?.params.chapterId) {
      document.title = `Tutorial - ${APP_NAME}`;
      return;
    }

    const page = STATIC_ROUTE_TITLES[location.pathname];
    document.title = page ? `${page} - ${APP_NAME}` : APP_NAME;
  }, [location.pathname]);

  return null;
}
