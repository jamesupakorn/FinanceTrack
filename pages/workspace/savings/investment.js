import WorkspaceShell from '../../../src/frontend/components/WorkspaceShell';
import InvestmentTable from '../../../src/frontend/components/InvestmentTable';

export default function WorkspaceSavingsInvestmentPage() {
  return (
    <WorkspaceShell section="investment">
      {({ selectedMonth, refreshTrigger, registerSave, markClean, markDirty }) => (
        <InvestmentTable
          selectedMonth={selectedMonth}
          onRegisterSave={registerSave}
          onSaved={markClean}
          markDirty={markDirty}
          key={`investment-${refreshTrigger}`}
        />
      )}
    </WorkspaceShell>
  );
}
