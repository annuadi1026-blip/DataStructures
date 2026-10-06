import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import Landing from './pages/Landing.jsx';
import { Login, Register } from './pages/AuthPages.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Today from './pages/Today.jsx';
import Questions from './pages/Questions.jsx';
import Revisions from './pages/Revisions.jsx';

const Roadmap = lazy(() => import('./pages/Roadmap.jsx'));
const QuestionDetail = lazy(() => import('./pages/QuestionDetail.jsx'));
const Progress = lazy(() => import('./pages/Progress.jsx'));
const Group = lazy(() => import('./pages/Group.jsx'));
const GroupMembers = lazy(() => import('./pages/GroupMembers.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

function DeferredRouteOutlet() {
  return <Suspense fallback={<Spinner label="Loading page" />}><Outlet /></Suspense>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/today" element={<Today />} />
        <Route path="/questions" element={<Questions />} />
        <Route path="/revisions" element={<Revisions />} />
        <Route element={<DeferredRouteOutlet />}>
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/questions/:id" element={<QuestionDetail />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/group" element={<Group />} />
          <Route path="/group/members" element={<GroupMembers />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/profile" element={<Navigate to="/settings/profile" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/profile" element={<Profile />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
