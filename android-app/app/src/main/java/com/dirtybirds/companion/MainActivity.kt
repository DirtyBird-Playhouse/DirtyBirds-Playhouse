package com.dirtybirds.companion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.rememberNavController
import com.dirtybirds.companion.data.db.AppDatabase
import com.dirtybirds.companion.data.model.Companion
import com.dirtybirds.companion.data.repository.CompanionRepository
import com.dirtybirds.companion.navigation.CompanionNavGraph
import com.dirtybirds.companion.navigation.Screen
import com.dirtybirds.companion.notification.CompanionNotificationWorker
import com.dirtybirds.companion.ui.screens.chat.ChatViewModel
import com.dirtybirds.companion.ui.theme.CompanionTheme
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

private val android.content.Context.dataStore by preferencesDataStore(name = "companion_prefs")

class MainActivity : ComponentActivity() {

    companion object {
        private val API_KEY = stringPreferencesKey("api_key")
        private val ONBOARDING_DONE = booleanPreferencesKey("onboarding_done")
        private val NOTIFICATIONS_ENABLED = booleanPreferencesKey("notifications_enabled")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val isOnboarded = runBlocking {
            dataStore.data.map { it[ONBOARDING_DONE] ?: false }.first()
        }
        val savedApiKey = runBlocking {
            dataStore.data.map { it[API_KEY] ?: "" }.first()
        }
        val savedNotifEnabled = runBlocking {
            dataStore.data.map { it[NOTIFICATIONS_ENABLED] ?: true }.first()
        }

        setContent {
            CompanionTheme {
                val navController = rememberNavController()
                val chatViewModel: ChatViewModel = viewModel()
                val scope = rememberCoroutineScope()

                var apiKey by remember { mutableStateOf(savedApiKey) }
                var notificationsEnabled by remember { mutableStateOf(savedNotifEnabled) }

                if (apiKey.isNotBlank()) {
                    chatViewModel.setApiKey(apiKey)
                }

                val startDestination = if (isOnboarded) Screen.Chat.route else Screen.Onboarding.route

                CompanionNavGraph(
                    navController = navController,
                    startDestination = startDestination,
                    chatViewModel = chatViewModel,
                    currentApiKey = apiKey,
                    notificationsEnabled = notificationsEnabled,
                    onApiKeyChange = { newKey ->
                        apiKey = newKey
                        chatViewModel.setApiKey(newKey)
                        scope.launch {
                            dataStore.edit { it[API_KEY] = newKey }
                        }
                    },
                    onNotificationsToggle = { enabled ->
                        notificationsEnabled = enabled
                        scope.launch {
                            dataStore.edit { it[NOTIFICATIONS_ENABLED] = enabled }
                        }
                        if (enabled) {
                            CompanionNotificationWorker.schedule(this@MainActivity)
                        } else {
                            CompanionNotificationWorker.cancel(this@MainActivity)
                        }
                    },
                    onOnboardingComplete = { name, personality, key ->
                        scope.launch {
                            val db = AppDatabase.getInstance(this@MainActivity)
                            val repo = CompanionRepository(db.companionDao())
                            repo.initializeCompanion(name, personality)

                            dataStore.edit {
                                it[ONBOARDING_DONE] = true
                                if (key.isNotBlank()) it[API_KEY] = key
                            }

                            if (key.isNotBlank()) {
                                apiKey = key
                                chatViewModel.setApiKey(key)
                            }

                            CompanionNotificationWorker.schedule(this@MainActivity)
                        }
                    }
                )
            }
        }
    }
}
