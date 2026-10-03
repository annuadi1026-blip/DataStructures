import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import { Login, Register } from './pages/AuthPages.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Today from './pages/Today.jsx';
import Roadmap from './pages/Roadmap.jsx';
import Questions from './pages/Questions.jsx';
import QuestionDetail from './pages/QuestionDetail.jsx';
import Progress from './pages/Progress.jsx';
import Group from './pages/Group.jsx';
import GroupMembers from './pages/GroupMembers.jsx';
import Notifications from './pages/Notifications.jsx';
import Revisions from './pages/Revisions.jsx';
import Profile from './pages/Profile.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/today" element={<Today />} />
        <Route path="/roadmap" element={<Roadmap />} />
        <Route path="/questions" element={<Questions />} />
        <Route path="/questions/:id" element={<QuestionDetail />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/group" element={<Group />} />
        <Route path="/group/members" element={<GroupMembers />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/revisions" element={<Revisions />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
