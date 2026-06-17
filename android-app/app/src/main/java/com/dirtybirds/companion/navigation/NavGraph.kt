package com.dirtybirds.companion.navigation

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.dirtybirds.companion.ui.screens.chat.ChatScreen
import com.dirtybirds.companion.ui.screens.chat.ChatViewModel
import com.dirtybirds.companion.ui.screens.onboarding.OnboardingScreen
import com.dirtybirds.companion.ui.screens.profile.ProfileScreen
import com.dirtybirds.companion.ui.screens.settings.SettingsScreen

sealed class Screen(val route: String) {
    data object Onboarding : Screen("onboarding")
    data object Chat : Screen("chat")
    data object Profile : Screen("profile")
    data object Settings : Screen("settings")
}

@Composable
fun CompanionNavGraph(
    navController: NavHostController,
    startDestination: String,
    chatViewModel: ChatViewModel = viewModel(),
    currentApiKey: String,
    notificationsEnabled: Boolean,
    onApiKeyChange: (String) -> Unit,
    onNotificationsToggle: (Boolean) -> Unit,
    onOnboardingComplete: (name: String, personality: String, apiKey: String) -> Unit
) {
    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.Onboarding.route) {
            OnboardingScreen { name, personality, apiKey ->
                onOnboardingComplete(name, personality, apiKey)
                navController.navigate(Screen.Chat.route) {
                    popUpTo(Screen.Onboarding.route) { inclusive = true }
                }
            }
        }

        composable(Screen.Chat.route) {
            ChatScreen(
                viewModel = chatViewModel,
                onNavigateToProfile = { navController.navigate(Screen.Profile.route) },
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) }
            )
        }

        composable(Screen.Profile.route) {
            ProfileScreen(
                viewModel = chatViewModel,
                onBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                currentApiKey = currentApiKey,
                notificationsEnabled = notificationsEnabled,
                onApiKeyChange = onApiKeyChange,
                onNotificationsToggle = onNotificationsToggle,
                onClearHistory = { chatViewModel.clearHistory() },
                onBack = { navController.popBackStack() }
            )
        }
    }
}
