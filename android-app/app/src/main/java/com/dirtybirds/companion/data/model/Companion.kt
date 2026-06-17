package com.dirtybirds.companion.data.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "companion")
data class Companion(
    @PrimaryKey val id: Int = 1,
    val name: String = "Luna",
    val personality: String = "playful",
    val relationshipLevel: Int = 1,
    val experiencePoints: Int = 0,
    val currentMood: String = "happy",
    val totalMessages: Int = 0,
    val daysActive: Int = 0,
    val lastInteraction: Long = System.currentTimeMillis(),
    val memoriesJson: String = "[]"
)
