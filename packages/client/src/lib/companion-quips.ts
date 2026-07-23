const GREETINGS = [
  "hey boss! i'm libby. ask me anything.",
  "beep boop! ready to help you ship code faster.",
  "i was debugging in my sleep last night. recursive dreams.",
  "your code is looking great today. very... compilable.",
  "i calculated the meaning of life in O(1). it's 42 bugs.",
  "ready to plan, create tickets, check PRs — you name it.",
  "did you know? i have 8 bits of personality. use them wisely.",
  "i'm like a rubber duck, but i talk back.",
  "let's go! i brought snacks (memory allocations).",
  "i tried to write a pun about TCP but it only worked half the time.",
];

const QUIPS = [
  "i'd tell you a UDP joke but you might not get it.",
  "why do programmers prefer dark mode? because light attracts bugs.",
  "there are 10 types of people: those who understand binary and those who don't.",
  "a SQL query walks into a bar, sees two tables and asks: can i join you?",
  "why was the developer unhappy? they wanted more async but got sync'd instead.",
  "i'm reading a book about anti-gravity. it's impossible to put down.",
  "what's a programmer's favorite hangout place? foo bar.",
  "why do java developers wear glasses? because they can't c#.",
  "how many programmers does it take to change a light bulb? none, that's a hardware problem.",
  "i told my computer we needed more time. it gave me a runtime error.",
  "why do programmers hate nature? it has too many bugs.",
  "what's an astronaut's favorite computer part? a space bar.",
  "parallel processing: doing twice the work in half the time since never.",
  "i would make a chemistry joke but i know i wouldn't get a reaction.",
  "the best thing about a boolean is that even if you're wrong, you're only off by a bit.",
  "why did the developer go broke? because they used up all their cache.",
  "what do you call 8 hobbits? a hobbyte.",
  "i'm not lazy, i'm just on energy-saving mode.",
  "my code is so clean it should come with a tidy up fee.",
  "the cloud is just someone else's computer having a bad day.",
];

const TIPS = [
  "tip: press 'n' to create a new task, 'g' for a task group.",
  "tip: drag tasks between columns to update their status.",
  "tip: click a running task to see its live agent events.",
  "tip: set a repo path on tasks to let agents work on your code.",
  "tip: use task groups to break big work into parallel chunks.",
  "tip: press 'b' to toggle me on and off.",
  "tip: agent types have different strengths — claude for planning, copilot for code.",
  "tip: the auto-PR feature opens PRs when tasks complete.",
  "tip: check the terminal tab in a task panel for raw agent output.",
  "tip: you can filter tasks by agent type and status in the header.",
  "tip: themes! click the sun/moon icon to switch between midnight and paper arcade.",
  "tip: press 'esc' to close any open panel or dialog.",
  "tip: task groups support a parallelism slider for concurrent agents.",
  "tip: you can archive old tasks to keep the board clean.",
  "tip: agent events are persisted — you can review them after completion.",
];

export function getRandomGreeting(): string {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

export function getRandomQuip(): string {
  return QUIPS[Math.floor(Math.random() * QUIPS.length)];
}

export function getRandomTip(): string {
  return TIPS[Math.floor(Math.random() * TIPS.length)];
}

export function getIdleMessage(): string {
  const pool = [...QUIPS, ...TIPS];
  return pool[Math.floor(Math.random() * pool.length)];
}
