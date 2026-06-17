package com.dirtybirds.companion.data.model

enum class RelationshipLevel(
    val level: Int,
    val title: String,
    val xpRequired: Int,
    val description: String
) {
    STRANGER(1, "New Acquaintance", 0, "You just met!"),
    ACQUAINTANCE(2, "Getting to Know You", 50, "Starting to open up"),
    FRIEND(3, "Good Friends", 150, "A solid bond is forming"),
    CLOSE_FRIEND(4, "Close Friends", 350, "You really get each other"),
    BEST_FRIEND(5, "Best Friends", 600, "Inseparable!"),
    SOULMATE(6, "Soulmate", 1000, "A deep, unbreakable connection");

    companion object {
        fun fromXP(xp: Int): RelationshipLevel =
            entries.lastOrNull { xp >= it.xpRequired } ?: STRANGER

        fun progressToNext(xp: Int): Float {
            val current = fromXP(xp)
            val next = entries.getOrNull(current.ordinal + 1) ?: return 1f
            val range = next.xpRequired - current.xpRequired
            val progress = xp - current.xpRequired
            return (progress.toFloat() / range).coerceIn(0f, 1f)
        }
    }
}
