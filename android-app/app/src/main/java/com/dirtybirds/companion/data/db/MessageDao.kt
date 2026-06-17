package com.dirtybirds.companion.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import com.dirtybirds.companion.data.model.Message
import kotlinx.coroutines.flow.Flow

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages ORDER BY timestamp ASC")
    fun getAllMessages(): Flow<List<Message>>

    @Query("SELECT * FROM messages ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getRecentMessages(limit: Int): List<Message>

    @Insert
    suspend fun insert(message: Message): Long

    @Query("DELETE FROM messages")
    suspend fun deleteAll()

    @Query("SELECT COUNT(*) FROM messages")
    suspend fun getMessageCount(): Int
}
