import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { schemas as s } from '../validators/index.js';
import * as auth from '../controllers/authController.js';
import * as q from '../controllers/questionController.js';
import * as p from '../controllers/progressController.js';
import * as g from '../controllers/groupController.js';
import * as n from '../controllers/notificationController.js';

const r = Router();

// Auth
r.post('/auth/register', authLimiter, validate(s.register), auth.register);
r.post('/auth/login', authLimiter, validate(s.login), auth.login);
r.post('/auth/logout', auth.logout);
r.get('/auth/me', requireAuth, auth.me);

// Cron (secret-protected, not user-authenticated)
r.post('/jobs/notifications', authLimiter, n.runJob);

r.use(requireAuth);

// Users
r.get('/users/me', auth.me);
r.patch('/users/me', validate(s.updateMe), auth.updateMe);
r.post('/users/me/password', authLimiter, validate(s.changePassword), auth.changePassword);
r.delete('/users/me', authLimiter, validate(s.deleteMe), auth.deleteMe);
r.post('/users/:userId/nudge', validate(s.userIdParam), n.nudge);

// Groups
r.post('/groups', validate(s.createGroup), g.create);
r.get('/groups', g.list);
r.post('/groups/join', validate(s.joinGroup), g.join);
r.get('/groups/:id', validate(s.groupId), g.get);
r.get('/groups/:id/progress', validate(s.groupId), g.progress);
r.post('/groups/:id/members', validate(s.addMember), g.addMember);
r.post('/groups/:id/invites', validate(s.createInvite), g.invite);
r.delete('/groups/:id/members/:userId', validate(s.removeMember), g.removeMember);
r.get('/groups/:id/questions/:questionId/shared', validate(s.groupQuestion), g.shared);

// Questions
r.get('/questions', validate(s.questionList), q.list);
r.get('/topics', q.topics);
r.get('/questions/:id', validate(s.idParam), q.get);
r.get('/questions/:id/approaches', validate(s.idParam), q.approaches);
r.get('/questions/:id/my-solution', validate(s.idParam), q.getMySolution);
r.put('/questions/:id/my-solution', validate(s.saveSolution), q.saveMySolution);
r.post('/questions/:id/submissions', validate(s.submitSolution), q.submitMySolution);
r.put('/questions/:id/share', validate(s.shareSolution), q.share);
r.delete('/questions/:id/share/:groupId', validate(s.unshare), q.unshare);

// Daily + progress + revisions
r.get('/daily', p.today);
r.get('/daily/:date', validate(s.dateParam), p.byDate);
r.get('/progress', p.overview);
r.get('/progress/topic/:topic', validate(s.topicParam), p.topic);
r.patch('/progress/:questionId', validate(s.setStatus), p.setStatus);
r.get('/revisions/due', p.dueRevisions);
r.post('/revisions/:questionId/complete', validate(s.questionIdParam), p.completeRevision);

// Notifications
r.get('/notifications', validate(s.notificationList), n.list);
r.patch('/notifications/read-all', n.markAllRead);
r.get('/notification-preferences', n.getPrefs);
r.patch('/notification-preferences', validate(s.prefs), n.setPrefs);
r.patch('/notifications/:id/read', validate(s.notificationId), n.markRead);

export default r;
