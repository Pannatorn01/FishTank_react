import { Component, type ErrorInfo, type ReactNode } from 'react';
import { downloadDataBackup, resetAllData } from '@/lib/storage';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level render-error catch-all (see docs/EDITOR_IMPROVEMENTS.md #1). Before this existed, any
 * component throwing during render - a malformed sprite loaded from localStorage, an edge case in a
 * hook - took down the whole app with a blank white screen and no way back except opening DevTools and
 * clearing storage manually. This can't fix the error, but it can stop the user from losing unsaved
 * work over it: offers a one-click backup of everything in localStorage (see downloadDataBackup),
 * separate from the reload/reset actions so a backup always happens *before* anything destructive.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught a render error:', error, info.componentStack);
  }

  private handleReset = (): void => {
    resetAllData();
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <h2>เกิดข้อผิดพลาดที่ไม่คาดคิด</h2>
          <p>หน้านี้แสดงผลต่อไม่ได้ แต่ข้อมูลที่บันทึกไว้ในเบราว์เซอร์ยังอยู่ - ดาวน์โหลดสำรองไว้ก่อนได้เลย</p>
          <div className="error-boundary-actions">
            <button type="button" className="error-boundary-btn error-boundary-btn-primary" onClick={() => downloadDataBackup()}>
              ดาวน์โหลดข้อมูลสำรอง
            </button>
            <button type="button" className="error-boundary-btn" onClick={() => window.location.reload()}>
              โหลดหน้าใหม่
            </button>
            <button type="button" className="error-boundary-btn error-boundary-btn-danger" onClick={this.handleReset}>
              ล้างข้อมูลทั้งหมดแล้วเริ่มใหม่
            </button>
          </div>
          <details className="error-boundary-details">
            <summary>รายละเอียดสำหรับนักพัฒนา</summary>
            <pre>{this.state.error.message}{'\n'}{this.state.error.stack}</pre>
          </details>
        </div>
      </div>
    );
  }
}
