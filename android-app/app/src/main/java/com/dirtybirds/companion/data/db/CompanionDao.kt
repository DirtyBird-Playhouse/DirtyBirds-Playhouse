package com.dirtybirds.companion.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.dirtybirds.companion.data.model.Companion
import kotlinx.coroutines.flow.Flow

@Dao
interface CompanionDao {
    @Query("SELECT * FROM companion WHERE id = 1")
    fun getCompanion(): Flow<Companion?>

    @Query("SELECT * FROM companion WHERE id = 1")
    suspend fun getCompanionSync(): Companion?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdate(companion: Companion)

    @Update
    suspend fun update(companion: Companion)

    @Query("UPDATE companion SET experiencePoints = experiencePoints + :xp, totalMessages = totalMessages + 1 WHERE id = 1")
    suspend fun addExperience(xp: Int)

    @Query("UPDATE companion SET currentMood = :mood WHERE id = 1")
    suspend fun updateMood(mood: String)

    @Query("UPDATE companion SET memoriesJson = :memoriesJson WHERE id = 1")
    suspend fun updateMemories(memoriesJson: String)

    @Query("UPDATE companion SET lastInteraction = :timestamp WHERE id = 1")
    suspend fun updateLastInteraction(timestamp: Long)
}
