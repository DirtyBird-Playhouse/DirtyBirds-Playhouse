package com.dirtybirds.companion.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dirtybirds.companion.data.model.Mood
import com.dirtybirds.companion.ui.theme.Pink40
import com.dirtybirds.companion.ui.theme.Rose40

@Composable
fun AvatarDisplay(
    mood: Mood,
    isTyping: Boolean,
    modifier: Modifier = Modifier
) {
    val infiniteTransition = rememberInfiniteTransition(label = "avatar")

    val breathScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.05f,
        animationSpec = infiniteRepeatable(
            animation = tween(2000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "breathe"
    )

    val bounceY by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = if (isTyping) -8f else 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(500),
            repeatMode = RepeatMode.Reverse
        ),
        label = "bounce"
    )

    val moodScale by animateFloatAsState(
        targetValue = when (mood) {
            Mood.EXCITED -> 1.15f
            Mood.HAPPY, Mood.PLAYFUL -> 1.08f
            Mood.SLEEPY -> 0.95f
            else -> 1f
        },
        animationSpec = tween(500),
        label = "moodScale"
    )

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(120.dp)
            .offset(y = bounceY.dp)
            .scale(breathScale * moodScale)
    ) {
        // Glow ring
        Box(
            modifier = Modifier
                .size(120.dp)
                .clip(CircleShape)
                .background(
                    Brush.radialGradient(
                        colors = listOf(
                            Color(mood.color).copy(alpha = 0.3f),
                            Color.Transparent
                        )
                    )
                )
        )

        // Avatar circle
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(100.dp)
                .shadow(8.dp, CircleShape)
                .clip(CircleShape)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(Pink40, Rose40)
                    )
                )
        ) {
            Text(
                text = if (isTyping) "💭" else mood.emoji,
                fontSize = 40.sp
            )
        }
    }
}
