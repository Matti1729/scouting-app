import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DashboardScreen } from '../screens/scout/DashboardScreen';
import { MatchListScreen } from '../screens/scout/MatchListScreen';
import { PlayerEvaluationScreen } from '../screens/scout/PlayerEvaluationScreen';
import { BeraterstatusScreen } from '../screens/scout/BeraterstatusScreen';
import { RootStackParamList } from './types';

export { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName="Dashboard"
    >
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="MatchList" component={MatchListScreen} />
      <Stack.Screen
        name="PlayerEvaluation"
        component={PlayerEvaluationScreen}
        options={{
          presentation: 'transparentModal',
          animation: 'fade',
        }}
      />
      <Stack.Screen name="Beraterstatus" component={BeraterstatusScreen} />
    </Stack.Navigator>
  );
}
