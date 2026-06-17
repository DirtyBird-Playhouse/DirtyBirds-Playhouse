package com.dirtybirds.companion.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import com.dirtybirds.companion.data.model.RelationshipLevel
import com.dirtybirds.companion.ui.theme.HeartRed
import com.dirtybirds.companion.ui.theme.Pink40
import com.dirtybirds.companion.ui.theme.XPGreen

@Composable
fun RelationshipBar(
    experiencePoints: Int,
    modifier: Modifier = Modifier
) {
    val level = RelationshipLevel.fromXP(experiencePoints)
    val progress = RelationshipLevel.progressToNext(experiencePoints)
    val animatedProgress by animateFloatAsState(
        targetValue = progress,
        animationSpec = tween(1000),
        label = "xpProgress"
    )

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                repeat(level.level) {
                    Text(text = "❤️", style = MaterialTheme.typography.labelSmall)
                }
            }
            Text(
                text = level.title,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(animatedProgress)
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(
                        Brush.horizontalGradient(
                            colors = listOf(Pink40, HeartRed)
                        )
                    )
            )
        }

        Text(
            text = "${experiencePoints} XP",
            style = MaterialTheme.typography.labelSmall,
            color = XPGreen,
            modifier = Modifier.padding(top = 2.dp)
        )
    }
}
