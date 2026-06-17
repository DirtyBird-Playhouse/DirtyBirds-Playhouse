package com.dirtybirds.companion.ui.screens.onboarding

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dirtybirds.companion.ui.theme.Pink40
import com.dirtybirds.companion.ui.theme.Rose40
import kotlinx.coroutines.delay

data class PersonalityOption(
    val id: String,
    val emoji: String,
    val name: String,
    val description: String
)

@Composable
fun OnboardingScreen(onComplete: (name: String, personality: String, apiKey: String) -> Unit) {
    var step by remember { mutableIntStateOf(0) }
    var companionName by remember { mutableStateOf("Luna") }
    var selectedPersonality by remember { mutableStateOf("playful") }
    var apiKey by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }

    LaunchedEffect(step) {
        visible = false
        delay(100)
        visible = true
    }

    val personalities = listOf(
        PersonalityOption("playful", "😜", "Playful & Witty", "Fun, teasing, and always keeps you laughing"),
        PersonalityOption("warm", "🥰", "Warm & Caring", "Sweet, supportive, and nurturing"),
        PersonalityOption("sassy", "💅", "Sassy & Bold", "Confident, opinionated, and exciting")
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.background,
                        Pink40.copy(alpha = 0.1f)
                    )
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        AnimatedVisibility(
            visible = visible,
            enter = fadeIn() + slideInVertically(initialOffsetY = { it / 4 })
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                when (step) {
                    0 -> WelcomeStep { step = 1 }
                    1 -> NameStep(companionName) { name ->
                        companionName = name
                        step = 2
                    }
                    2 -> PersonalityStep(personalities, selectedPersonality) { personality ->
                        selectedPersonality = personality
                        step = 3
                    }
                    3 -> ApiKeyStep(apiKey) { key ->
                        apiKey = key
                        onComplete(companionName, selectedPersonality, apiKey)
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Step indicator
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(4) { index ->
                        Box(
                            modifier = Modifier
                                .size(if (index == step) 12.dp else 8.dp)
                                .clip(RoundedCornerShape(50))
                                .background(
                                    if (index <= step) Pink40
                                    else Pink40.copy(alpha = 0.3f)
                                )
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun WelcomeStep(onNext: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = "💕", fontSize = 64.sp)
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Welcome to\nDirtyBirds Companion",
            style = MaterialTheme.typography.headlineLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onBackground
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Your AI companion awaits",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f)
        )
        Spacer(modifier = Modifier.height(32.dp))
        Button(onClick = onNext, modifier = Modifier.fillMaxWidth()) {
            Text("Get Started", fontSize = 16.sp)
        }
    }
}

@Composable
private fun NameStep(currentName: String, onNext: (String) -> Unit) {
    var name by remember { mutableStateOf(currentName) }

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = "✨", fontSize = 48.sp)
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Name Your Companion",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground
        )
        Spacer(modifier = Modifier.height(24.dp))
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Companion Name") },
            singleLine = true
        )
        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = { onNext(name.ifBlank { "Luna" }) },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Continue", fontSize = 16.sp)
        }
    }
}

@Composable
private fun PersonalityStep(
    personalities: List<PersonalityOption>,
    selected: String,
    onNext: (String) -> Unit
) {
    var selectedId by remember { mutableStateOf(selected) }

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = "🎭", fontSize = 48.sp)
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Choose a Personality",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground
        )
        Spacer(modifier = Modifier.height(24.dp))

        personalities.forEach { personality ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
                    .clickable { selectedId = personality.id },
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (selectedId == personality.id)
                        Pink40.copy(alpha = 0.2f)
                    else MaterialTheme.colorScheme.surface
                ),
                border = if (selectedId == personality.id)
                    CardDefaults.outlinedCardBorder()
                else null
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(text = personality.emoji, fontSize = 28.sp)
                    Column(modifier = Modifier.padding(start = 12.dp)) {
                        Text(
                            text = personality.name,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = personality.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = { onNext(selectedId) },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Continue", fontSize = 16.sp)
        }
    }
}

@Composable
private fun ApiKeyStep(currentKey: String, onComplete: (String) -> Unit) {
    var key by remember { mutableStateOf(currentKey) }

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = "🔑", fontSize = 48.sp)
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Connect to Claude",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Enter your Anthropic API key to enable AI conversations. You can add this later in Settings.",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f)
        )
        Spacer(modifier = Modifier.height(24.dp))
        OutlinedTextField(
            value = key,
            onValueChange = { key = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("API Key (optional)") },
            placeholder = { Text("sk-ant-...") },
            singleLine = true
        )
        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = { onComplete(key) },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = if (key.isBlank()) "Skip for Now" else "Let's Go!",
                fontSize = 16.sp
            )
        }
    }
}
