import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DashboardScreen } from '../screens/scout/DashboardScreen';
import { MatchListScreen } from '../screens/scout/MatchListScreen';
import { PlayerEvaluationScreen } from '../screens/scout/PlayerEvaluationScreen';
import { BeraterstatusScreen } from '../screens/scout/BeraterstatusScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { RootStackParamList } from './types';

export { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  const { session, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!session) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }

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
