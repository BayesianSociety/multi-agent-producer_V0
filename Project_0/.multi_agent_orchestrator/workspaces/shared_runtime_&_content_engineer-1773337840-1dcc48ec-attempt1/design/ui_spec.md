# Pet Vet Coding Puzzles UI Specification

## Primary Screens / Views
1. **Landing + Session Start**
   - Hero banner with title, mentor illustration, and Start button.
   - Secondary actions: View Teacher Guide (local docs), Accessibility settings link.
   - On Start click, call `/api/session/start`, show spinner until sessionId assigned, then transition to Level Select.
2. **Level Select / Progress Map**
   - Grid of 17 puzzle nodes with lock/unlock status (completed nodes show checkmark, current node highlighted).
   - Sidebar displays learner stats (time played, attempts) and latest hint from mentor.
   - CTA buttons: Resume Puzzle, View Analytics (educator-only toggle), Back to Landing.
3. **Gameplay Workspace**
   - **Top Bar**: Title, puzzle count (“Puzzle X of 17”), progress bar, sound toggle, accessibility menu.
   - **Scene Canvas** (center/right): Clinic background, pet + mentor sprites, goal banner, speech bubble.
   - **Workspace Overlay** (left slide-in): command library columns, active code area with On Start root, Play/Reset/Step/Speed controls, Show Code toggle.
   - **Status Area**: Run timer, block count, hint slot.
4. **Oops Modal**
   - Triggered after failed run; shows “Oops!”, failure reason, hint text, and quick link to highlight offending block.
   - Buttons: “Try Again” (returns to workspace), “View Hint Log”.
5. **Success Celebration**
   - Overlay confetti animation, success message summarizing actions taken, Next Puzzle + Replay buttons.
6. **Analytics Dashboard** (educator view)
   - Cards summarizing total sessions, attempts, success rate, avg attempts per puzzle, avg time per puzzle.
   - Table listing puzzle completion stats.
7. **Puzzle Detail Analytics**
   - Attempt timeline cards (timestamp, user, result, failure reason) with “View Code Snapshot” toggle.
   - Movement replay canvas showing path from `movements` data; play/pause scrubber.
8. **Event Stream Viewer**
   - Filter controls (sessionId, attemptId, puzzleId, type search).
   - Paginated table with timestamp, event type, formatted payload JSON.

## Interaction Model
- **Block Library → Workspace**: Drag blocks from category stacks into code column; snapping indicated via magnet animation. Blocks can be reordered vertically or nested (loops/conditionals). Deleted by dragging back or pressing Delete when selected.
- **Play Control**: Disables block editing, hides workspace overlay (slides left) while run animates. Step button executes one instruction per click for debugging. Speed toggle cycles slow/normal/fast animation timing.
- **Show Code Toggle**: Flips right panel into read-only text view of block AST; returning to blocks preserves arrangement.
- **Hint Highlighting**: When runtime signals failureReason, workspace scrolls to highlight offending block in amber, simultaneously showing Oops modal.
- **Analytics Filters**: Dashboard cards clickable to drill into puzzle detail; event viewer filters debounce input and auto-refresh results when query parameters change.

## State Transitions
- Landing → Level Select after successful session start.
- Level Select → Gameplay when user selects unlocked puzzle; loads puzzle data, resets workspace state, fetches latest progress for user.
- Gameplay states: `editing` (default), `running` (during execution), `paused` (step mode), `failure` (Oops modal), `success` (celebration overlay). Transitions controlled by shared runtime events and attempt lifecycle API responses.
- Success returns to Level Select automatically after user acknowledges Next Puzzle; failure returns to editing when Try Again clicked.
- Analytics view toggled via educator switch; persists last viewed tab in local storage. Puzzle detail state depends on selected puzzle ID; selecting attempt triggers detail drawer with code snapshot + replay.

## Empty / Loading / Error States
- **Landing**: If `/api/session/start` fails, show inline error with retry and diagnostics link; button disabled until retry timer completes.
- **Level Select**: While puzzle_progress loads, show skeleton cards; if no data, default to puzzle 1 unlocked and display helper text.
- **Gameplay**: During puzzle data load, dim workspace and show spinner overlay; if shared runtime fails to load, show blocking error with reload instructions.
- **Analytics Dashboard**: Loading spinners on cards and charts; empty states with encouragement copy (“No attempts recorded yet”) and CTA to run sample session. API errors display toast plus inline fallback with retry button.
- **Event Stream**: Show “No events for selected filters” placeholder; differentiate between true empty vs. error via iconography.

## Accessibility Basics
- All primary controls reachable via keyboard: Tab order from top bar → workspace categories → code blocks (arrow keys move focus). Space/Enter begins drag substitute for keyboard-only block placement.
- Provide ARIA labels for command categories, Play/Reset buttons, speed toggle, analytics filters, and canvas replays (including live region updates for scene status).
- Color palette meets WCAG AA for text on backgrounds; ensure success/failure states use icon + text, not color alone.
- Include text-size slider in accessibility menu impacting workspace labels, hints, and analytics text.
- Provide optional text-to-speech for goalText and hints triggered via screen reader-friendly buttons near speech bubble and Oops modal.
- Animations respect reduced-motion preference: disable confetti and limit tween speed when `prefers-reduced-motion` detected.
