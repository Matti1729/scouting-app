export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  MatchList: { openMatchId?: string } | undefined;
  PlayerEvaluation: {
    matchId?: string;
    matchName?: string;
    matchDate?: string;
    matchArt?: string;
    matchZeit?: string;
    fussballDeUrl?: string;
    mannschaft?: string;
    playerName?: string;
    playerNumber?: string;
    playerPosition?: string;
    playerBirthYear?: string;
  };
  Watchlist: undefined;
  Sportstipendium: undefined;
  Suchmaschine: undefined;
};
