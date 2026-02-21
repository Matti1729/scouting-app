export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  MatchList: undefined;
  PlayerEvaluation: {
    matchId?: string;
    matchName?: string;
    matchDate?: string;
    mannschaft?: string;
    playerName?: string;
    playerNumber?: string;
    playerPosition?: string;
    playerBirthYear?: string;
  };
  Beraterstatus: undefined;
  Watchlist: undefined;
};
