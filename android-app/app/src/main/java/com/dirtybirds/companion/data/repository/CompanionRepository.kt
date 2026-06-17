package com.dirtybirds.companion.data.repository

import com.dirtybirds.companion.data.db.CompanionDao
import com.dirtybirds.companion.data.model.Companion
import com.dirtybirds.companion.data.model.Mood
import com.dirtybirds.companion.data.model.RelationshipLevel
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.flow.Flow

class CompanionRepository(private val companionDao: CompanionDao) {

    private val gson = Gson()

    fun getCompanion(): Flow<Companion?> = companionDao.getCompanion()

    suspend fun getCompanionSync(): Companion? = companionDao.getCompanionSync()

    suspend fun initializeCompanion(name: String, personality: String) {
        companionDao.insertOrUpdate(
            Companion(name = name, personality = personality)
        )
    }

    suspend fun addExperience(xp: Int = 5) {
        companionDao.addExperience(xp)
        val companion = companionDao.getCompanionSync() ?: return
        val newLevel = RelationshipLevel.fromXP(companion.experiencePoints)
        if (newLevel.level != companion.relationshipLevel) {
            companionDao.insertOrUpdate(companion.copy(relationshipLevel = newLevel.level))
        }
    }

    suspend fun updateMood(mood: Mood) {
        companionDao.updateMood(mood.name)
    }

    suspend fun addMemory(memory: String) {
        val companion = companionDao.getCompanionSync() ?: return
        val type = object : TypeToken<MutableList<String>>() {}.type
        val memories: MutableList<String> = try {
            gson.fromJson(companion.memoriesJson, type)
        } catch (_: Exception) {
            mutableListOf()
        }
        memories.add(memory)
        if (memories.size > 50) {
            memories.removeAt(0)
        }
        companionDao.updateMemories(gson.toJson(memories))
    }

    suspend fun getMemories(): List<String> {
        val companion = companionDao.getCompanionSync() ?: return emptyList()
        val type = object : TypeToken<List<String>>() {}.type
        return try {
            gson.fromJson(companion.memoriesJson, type)
        } catch (_: Exception) {
            emptyList()
        }
    }

    suspend fun updateLastInteraction() {
        companionDao.updateLastInteraction(System.currentTimeMillis())
    }
}
