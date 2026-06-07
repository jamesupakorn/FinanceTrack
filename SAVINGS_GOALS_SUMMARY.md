# Savings Goals MongoDB Schema - Executive Summary

## 📊 Quick Reference

| Aspect | Decision |
|--------|----------|
| **Collection** | `savingsGoals` (separate from `savings`) |
| **Storage Model** | Document-per-goal + computed metadata |
| **User Scope** | Per-user (`userId` field, indexed) |
| **Data Types** | Numbers, Strings, Dates, Arrays |
| **Key Fields** | userId, goalName, targetAmount, currentAmount, metadata |
| **Indexes** | 5 key indexes on userId, status, category, endDate |
| **Validation** | Built-in schema validator with required fields |
| **Soft Delete** | Yes (status = 'abandoned' instead of hard delete) |
| **Real-time Updates** | Event-driven sync when savings updated |
| **Transactions** | Not required (single-document updates are atomic) |

---

## 🎯 Core Features

### 1. **Goal Tracking**
- Store per-user savings goals (wedding, emergency, vacation, etc.)
- Track target amounts and current progress
- Auto-calculate remaining amounts needed

### 2. **Progress Visualization**
- Progress percentage: `(currentAmount / targetAmount) * 100`
- Visual representation in UI: "Wedding Fund 120k/250k (48%)"
- Progress bars in Savings tab

### 3. **Smart Metadata**
```javascript
metadata: {
  progressPercentage,        // Auto-calculated
  remainingAmount,           // Auto-calculated
  monthlyContribution,       // User-defined or auto-estimated
  estimatedCompletionDate    // Auto-calculated from monthly rate
}
```

### 4. **Goal Categories**
- Emergency (high priority)
- Investment
- Wedding
- Vacation
- Education
- Other

### 5. **Priority & Deadlines**
- Priority levels: low, medium, high
- Optional deadline dates
- Sorting by urgency (priority + deadline)

---

## 📈 Document Structure Example

**For User u001 with 3 goals:**

```
savingsGoals
├── u001 - Wedding Fund (48% complete, ৳130k remaining)
├── u001 - Emergency Fund (71% complete, ৳35k remaining)
└── u001 - Japan Vacation (56% complete, ৳35k remaining)
```

**Single Document:**
```json
{
  "_id": ObjectId("507f..."),
  "userId": "u001",
  "goalName": "Wedding Fund",
  "targetAmount": 250000,
  "currentAmount": 120000,
  "metadata": {
    "progressPercentage": 48.0,
    "remainingAmount": 130000,
    "estimatedCompletionDate": "2025-06-02"
  }
}
```

---

## 🔗 Integration with Savings Tab

### Current Workflow
```
Savings Tab (Monthly Data)
    ↓
POST /api/savings
    ↓
Update savings collection
    ↓
Trigger syncGoalsWithSavings()
    ↓
Update savingsGoals.currentAmount
    ↓
Recalculate metadata
    ↓
Check if any goals completed
```

### Result: Real-time Goal Progress
- User saves ৳15,000 in June
- Savings tab shows ৳15,000 total
- **Goals automatically update** to reflect new progress
- If goal reached target → mark as "completed" + show celebration

---

## 🚀 API Endpoints

```
GET    /api/savings-goals              # List all goals (active by default)
POST   /api/savings-goals              # Create new goal
GET    /api/savings-goals/:goalId      # Get single goal
PUT    /api/savings-goals/:goalId      # Update goal
DELETE /api/savings-goals/:goalId      # Archive goal

POST   /api/savings-goals/sync/:month  # Sync with monthly savings (internal)
```

---

## 📝 Query Examples

### Get User's Active Goals
```javascript
db.savingsGoals.find({
  userId: "u001",
  status: "active"
}).sort({ priority: -1, endDate: 1 });
```

### Get Goal Progress
```javascript
db.savingsGoals.findOne({
  _id: ObjectId("507f1f77bcf86cd799439011")
});
// Returns: progressPercentage, remainingAmount, estimatedCompletionDate
```

### Check Goals Near Completion
```javascript
db.savingsGoals.find({
  userId: "u001",
  status: "active",
  "metadata.progressPercentage": { $gte: 85 }
});
```

---

## 💾 Storage Considerations

### Why Separate Collection?
- **vs Nested in Savings**: Goals persist across ALL time, not per-month
- **vs Nested in Users**: Goals would be hidden in user document, harder to query
- **Benefits**: 
  - Clean separation of concerns
  - Efficient per-user queries
  - Easy to add features (goal analytics, templates, etc.)

### Document Size Estimate
- ~1KB per goal document
- User with 10 goals ≈ 10KB
- System with 1000 users × 10 goals = 10MB (negligible for MongoDB)

---

## 🔒 Security

### Field-Level Access Control
```javascript
// Only return goals for authenticated user
db.savingsGoals.find({ userId: authenticatedUserId })
```

### API Protection
```javascript
const userId = assertUserId(req, res);  // Validate session
if (!userId) return res.status(401).end();

// All queries filtered by userId
const goals = await collection.find({ userId }).toArray();
```

### Data Validation
- `targetAmount` must be > 0
- `currentAmount` checked against `targetAmount`
- Status enum validation (no arbitrary values)

---

## 📊 Example Scenarios

### Scenario 1: Creating a Goal
```
User: "I want to save ৳250k for my wedding by June 2025"
↓
API creates goal:
  {
    goalName: "Wedding Fund",
    targetAmount: 250000,
    endDate: "2025-06-30",
    category: "wedding",
    priority: "high"
  }
↓
Goal stored in savingsGoals with metadata:
  progressPercentage: 0
  remainingAmount: 250000
  estimatedCompletionDate: null (no monthly contribution yet)
```

### Scenario 2: Monthly Savings Update
```
User saves ৳15,000 in June 2024
↓
Savings tab shows: ৳15,000 total
↓
Goal syncs automatically:
  currentAmount: 15000
  metadata.progressPercentage: 6.0%
  metadata.remainingAmount: 235000
↓
If monthly contribution set to ৳4,000:
  estimatedCompletionDate: June 2025 ✓ (On track!)
```

### Scenario 3: Goal Completion
```
By June 2025, savings reach ৳250,000
↓
Wedding Fund goal updates:
  currentAmount: 250000
  status: "completed" (auto-changed from "active")
  metadata.progressPercentage: 100.0
↓
UI shows: 🎉 Wedding Fund completed!
```

---

## ⚙️ Implementation Phases

### Phase 1: Database Setup (Week 1)
- [ ] Create collection with schema validator
- [ ] Create indexes
- [ ] Write MongoDB migration script

### Phase 2: API Development (Week 1-2)
- [ ] Build CRUD endpoints (`/api/savings-goals`)
- [ ] Build sync endpoint (`/api/savings-goals/sync/:month`)
- [ ] Integrate with existing `/api/savings` endpoint

### Phase 3: Frontend (Week 2-3)
- [ ] Build `SavingsGoalsWidget` component
- [ ] Build `GoalModal` (create/edit)
- [ ] Integrate into Savings tab
- [ ] Mobile responsive design

### Phase 4: Testing & Deployment (Week 3-4)
- [ ] Unit tests for API functions
- [ ] E2E tests for user workflows
- [ ] Load testing (handle 1000+ goals/user)
- [ ] Deploy with feature flag

---

## 📋 Checklist Before Launch

- [ ] All indexes created
- [ ] Schema validator in place
- [ ] API endpoints fully tested
- [ ] Sync logic tested (goals update correctly after savings change)
- [ ] Completion detection tested (status changes to "completed")
- [ ] Soft delete working (goals archived, not removed)
- [ ] UI shows progress bars correctly
- [ ] Mobile responsive
- [ ] Example user (u001) has sample goals
- [ ] Documentation complete
- [ ] Security review passed (userId validation on all queries)

---

## 🔗 Related Documents

1. **SCHEMA_DESIGN_SAVINGS_GOALS.md** - Comprehensive design (16KB)
2. **SAVINGS_GOALS_IMPLEMENTATION.json** - Structured data (11KB)
3. **API_SAVINGS_GOALS_SPEC.js** - API specification with examples (13KB)

---

## 📞 Questions & Answers

**Q: How are goals allocated to savings?**
A: By default, all monthly savings go to each active goal proportionally (or user can define allocation).

**Q: What if user changes target amount?**
A: Remaining amount and progress percentage auto-recalculate. Status doesn't change unless manually edited.

**Q: Can goals be shared between users?**
A: No. `userId` field ensures each user only sees their own goals.

**Q: What if savings are edited/deleted?**
A: Goal current amount should be re-synced from total savings. This is handled in the sync endpoint.

**Q: How do I get goals grouped by category?**
A: Query with `category` filter and aggregate results in frontend.

---

## 📌 Last Updated
June 10, 2024 | Version 1.0 | FinanceTrack MongoDB Schema Design
