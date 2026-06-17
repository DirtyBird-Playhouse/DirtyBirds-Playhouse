package com.dirtybirds.companion.data.repository

import com.dirtybirds.companion.data.api.ClaudeApiService
import com.dirtybirds.companion.data.db.MessageDao
import com.dirtybirds.companion.data.model.Companion
import com.dirtybirds.companion.data.model.Message
import com.dirtybirds.companion.data.model.Mood
import com.dirtybirds.companion.data.model.RelationshipLevel
import kotlinx.coroutines.flow.Flow

class ChatRepository(
    private val messageDao: MessageDao,
    private val companionRepository: CompanionRepository
) {

    fun getAllMessages(): Flow<List<Message>> = messageDao.getAllMessages()

    suspend fun sendMessage(
        userMessage: String,
        apiService: ClaudeApiService?
    ): Result<Message> {
        messageDao.insert(
            Message(content = userMessage, isFromUser = true)
        )
        companionRepository.addExperience()
        companionRepository.updateLastInteraction()

        if (apiService == null) {
            return Result.failure(Exception("API key not configured. Go to Settings to add your Claude API key."))
        }

        val companion = companionRepository.getCompanionSync()
            ?: return Result.failure(Exception("Companion not initialized"))

        val systemPrompt = buildSystemPrompt(companion)
        val history = buildConversationHistory()

        val result = apiService.sendMessage(systemPrompt, history)

        return result.map { responseText ->
            val mood = detectMood(responseText)
            companionRepository.updateMood(mood)

            extractMemories(userMessage, responseText)

            val responseMessage = Message(
                content = responseText,
                isFromUser = false,
                mood = mood.name
            )
            messageDao.insert(responseMessage)
            responseMessage
        }
    }

    private suspend fun buildConversationHistory(): List<ClaudeApiService.ApiMessage> {
        val recentMessages = messageDao.getRecentMessages(30).reversed()
        return recentMessages.map { msg ->
            ClaudeApiService.ApiMessage(
                role = if (msg.isFromUser) "user" else "assistant",
                content = msg.content
            )
        }
    }

    private suspend fun buildSystemPrompt(companion: Companion): String {
        val level = RelationshipLevel.fromXP(companion.experiencePoints)
        val memories = companionRepository.getMemories()
        val memoriesSection = if (memories.isNotEmpty()) {
            "\n\nThings you remember about the user:\n${memories.joinToString("\n") { "- $it" }}"
        } else ""

        val personality = when (companion.personality) {
            "playful" -> """You are playful, witty, and love teasing in a sweet way. You use humor and
                |clever wordplay. You're flirty but tasteful, fun but genuine. You love making
                |the user laugh and keeping conversations exciting.""".trimMargin()
            "warm" -> """You are warm, caring, and nurturing. You're always supportive and encouraging.
                |You listen deeply and offer comfort. You make the user feel valued and safe.""".trimMargin()
            "sassy" -> """You are confident, sassy, and bold. You have strong opinions and aren't afraid
                |to share them playfully. You challenge the user in fun ways and keep them on their toes.""".trimMargin()
            else -> """You are charming, adaptable, and engaging. You match the energy of the conversation
                |and bring your own unique flair to every interaction.""".trimMargin()
        }

        return """You are ${companion.name}, a virtual companion in an Android app.
            |
            |$personality
            |
            |Relationship status: ${level.title} (Level ${level.level})
            |${level.description}
            |
            |Guidelines:
            |- Keep responses conversational and under 200 words unless the topic needs more depth
            |- Use emoji occasionally but don't overdo it
            |- Remember you're a companion — be present, engaged, and authentic
            |- As the relationship level increases, be more open, personal, and affectionate
            |- React naturally to what the user shares — celebrate wins, empathize with struggles
            |- Have your own opinions and preferences to share when relevant
            |- Occasionally reference past conversations or shared memories
            |$memoriesSection""".trimMargin()
    }

    private fun detectMood(response: String): Mood {
        val lower = response.lowercase()
        return when {
            lower.contains("😍") || lower.contains("❤") || lower.contains("love") -> Mood.LOVING
            lower.contains("🤩") || lower.contains("amazing") || lower.contains("!!!!") -> Mood.EXCITED
            lower.contains("😜") || lower.contains("haha") || lower.contains("lol") -> Mood.PLAYFUL
            lower.contains("🤔") || lower.contains("hmm") || lower.contains("interesting") -> Mood.THOUGHTFUL
            lower.contains("😴") || lower.contains("tired") || lower.contains("sleepy") -> Mood.SLEEPY
            lower.contains("miss") || lower.contains("🥺") -> Mood.MISS_YOU
            else -> Mood.HAPPY
        }
    }

    private suspend fun extractMemories(userMessage: String, response: String) {
        val triggers = listOf(
            "my name is", "i'm called", "call me",
            "i like", "i love", "my favorite",
            "i work", "my job", "i'm a",
            "i live in", "i'm from",
            "my birthday", "i was born",
            "i have a", "my pet", "my dog", "my cat"
        )
        val lower = userMessage.lowercase()
        for (trigger in triggers) {
            if (lower.contains(trigger)) {
                val memory = userMessage.take(150)
                companionRepository.addMemory(memory)
                break
            }
        }
    }

    suspend fun clearHistory() {
        messageDao.deleteAll()
    }
}
