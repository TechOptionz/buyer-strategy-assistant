# Buyer Strategy Assistant — screen and journey plan

Written before any application code, as Section 16 and the master prompt require. Every screen from Section 7 is listed with its purpose, main components and states. The coverage check is at the end.

## Navigation

```
/login
/cases                         Case dashboard
/cases/new                     Create assessment (choose Paste notes or Guided conversation)
/cases/[id]                    Assessment workspace (default tab: Interview)
/cases/[id]?tab=profile        Buyer profile
/cases/[id]?tab=research       Research (areas + evidence)
/cases/[id]?tab=scenarios      Scenario lab
/cases/[id]?tab=report         Report editor
/admin                         Administration
```

The top bar holds the product name, organisation, the signed-in user and a sign-out control. The case header holds the buyer name, purpose, status chip, save state and topic progress. The tab bar follows the end-to-end journey (Section 4): Interview → Profile → Research → Scenarios → Report.

## Primary journey (Milestone 1–3 critical path)

1. **Dashboard → New assessment.** The agent enters the buyer display name and picks *Paste notes* or *Guided conversation*.
2. **Interview tab.** The conversation is in the main panel and the live profile panel sits beside it (stacked below on mobile).
   - Paste notes → extraction job → proposed facts with their supporting text → confirm, edit or reject (bulk confirm allowed).
   - Guided → one main question with a reason, quick answers, a numeric or location control and a free-text alternative. The controls are Back, Edit answer, Not sure, Skip optional, and Save and continue later.
3. **Profile tab.** A structured editor grouped by topic. Each field shows its source, confirmation state, who confirmed it and its history. Conflicts appear at the top with a "which value is current?" resolver.
4. **Research tab.** Selected areas (up to 3) appear in a comparison table with a column per area and Meets / Partly / Does not meet / Unknown for each criterion. A source drawer shows dated metrics. The page also has a manual evidence form and the provider adapter status.
5. **Scenarios tab.** Base case plus up to two alternatives. It has the input controls, a funds breakdown, repayment and cashflow results, a natural-language "What if…" box (proposed patch → Run) and a side-by-side comparison with deltas and explanations. Stale markers show when inputs have changed.
6. **Report tab.** Section preview, editable agent commentary, an assumptions and sources list, unresolved conclusions, Submit for review / Mark reviewed / Request changes, Export PDF, and the version history.

## Reusable components

| Component | Used by |
|---|---|
| `AppShell`, `CaseHeader`, `Tabs` | All case pages |
| `StatusChip` (text label and icon, never colour alone) | Dashboard, header, report |
| `MoneyInput`, `PercentInput`, `ChoiceButtons`, `LocationInput` | Interview, profile, scenarios |
| `FactRow` (value, source quote, state, confirm/edit/reject) | Interview panel, profile |
| `ConflictResolver` | Interview, profile |
| `ReadinessList` ("Scenario inputs complete; finance limit unresolved") | Header popover, live panel, report |
| `TopicProgress` | Case header |
| `FitBadge` (Meets / Partly meets / Does not meet / Unknown) | Research, report |
| `ResultTable` with old/new/delta columns | Scenarios, report |
| `EmptyState`, `ErrorState`, `StaleBanner`, `SaveIndicator`, `AccessDenied` | Everywhere |

## States checklist per screen

Loading, empty, saved, unsaved, failed, stale and access-denied states are required on every screen where they apply. AI or provider failure always leaves the manual path usable and never erases input.

## Coverage check against Section 7

| Section 7 screen | Planned at | Covered |
|---|---|---|
| Case dashboard | `/cases` | ✅ |
| Assessment workspace | `/cases/[id]` Interview tab | ✅ |
| Buyer profile | Profile tab | ✅ |
| Research | Research tab | ✅ |
| Scenario lab | Scenarios tab | ✅ |
| Report editor | Report tab | ✅ |
| Administration | `/admin` | ✅ |
