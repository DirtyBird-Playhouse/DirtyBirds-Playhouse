package com.dirtybirds.companion.ui.screens.chat

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dirtybirds.companion.data.api.ClaudeApiService
import com.dirtybirds.companion.data.db.AppDatabase
import com.dirtybirds.companion.data.model.Companion
import com.dirtybirds.companion.data.model.Message
import com.dirtybirds.companion.data.model.Mood
import com.dirtybirds.companion.data.repository.ChatRepository
import com.dirtybirds.companion.data.repository.CompanionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class ChatViewModel(application: Application) : AndroidViewModel(application) {

    private val db = AppDatabase.getInstance(application)
    private val companionRepository = CompanionRepository(db.companionDao())
    private val chatRepository = ChatRepository(db.messageDao(), companionRepository)

    val messages: StateFlow<List<Message>> = chatRepository.getAllMessages()
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    val companion: StateFlow<Companion?> = companionRepository.getCompanion()
        .stateIn(viewModelScope, SharingStarted.Lazily, null)

    private val _isTyping = MutableStateFlow(false)
    val isTyping: StateFlow<Boolean> = _isTyping.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _currentMood = MutableStateFlow(Mood.HAPPY)
    val currentMood: StateFlow<Mood> = _currentMood.asStateFlow()

    private var apiService: ClaudeApiService? = null

    fun setApiKey(key: String) {
        apiService = if (key.isNotBlank()) ClaudeApiService(key) else null
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return

        viewModelScope.launch {
            _isTyping.value = true
            _error.value = null

            val result = chatRepository.sendMessage(text, apiService)

            result.onSuccess { message ->
                message.mood?.let { mood ->
                    _currentMood.value = Mood.fromString(mood)
                }
            }.onFailure { exception ->
                _error.value = exception.message
            }

            _isTyping.value = false
        }
    }

    fun clearError() {
        _error.value = null
    }

    fun clearHistory() {
        viewModelScope.launch {
            chatRepository.clearHistory()
        }
    }
}
