package com.dirtybirds.companion.data.model

enum class Mood(
    val emoji: String,
    val label: String,
    val color: Long
) {
    HAPPY("😊", "Happy", 0xFFFFD700),
    EXCITED("🤩", "Excited", 0xFFFF6B6B),
    PLAYFUL("😜", "Playful", 0xFFFF69B4),
    LOVING("🥰", "Loving", 0xFFFF1493),
    THOUGHTFUL("🤔", "Thoughtful", 0xFF87CEEB),
    SLEEPY("😴", "Sleepy", 0xFF9B59B6),
    MISS_YOU("🥺", "Missing You", 0xFFE74C3C),
    NEUTRAL("😌", "Relaxed", 0xFF2ECC71);

    companion object {
        fun fromString(value: String): Mood =
            entries.find { it.name.equals(value, ignoreCase = true) } ?: NEUTRAL
    }
}
