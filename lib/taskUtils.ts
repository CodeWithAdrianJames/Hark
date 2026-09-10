import { TaskItem } from '@/components/TaskCard';

export type LifecycleCategory = 'upcoming' | 'past_due' | 'completed';

export function isTaskCompleted(task: TaskItem): boolean {
  return Boolean(task.is_completed ?? task.completed ?? task.status === 'completed');
}

export function isTaskPastDue(task: TaskItem, now: Date = new Date()): boolean {
  if (isTaskCompleted(task)) return false;
  const due = new Date(task.due_date);
  return !isNaN(due.getTime()) && due.getTime() < now.getTime();
}

export function isTaskUpcoming(task: TaskItem, now: Date = new Date()): boolean {
  if (isTaskCompleted(task)) return false;
  const due = new Date(task.due_date);
  return isNaN(due.getTime()) || due.getTime() >= now.getTime();
}

export interface CategorizedTasks {
  upcoming: TaskItem[];
  pastDue: TaskItem[];
  completed: TaskItem[];
}

export function categorizeTasks(tasks: TaskItem[], now: Date = new Date()): CategorizedTasks {
  const upcoming: TaskItem[] = [];
  const pastDue: TaskItem[] = [];
  const completed: TaskItem[] = [];

  for (const task of tasks) {
    if (isTaskCompleted(task)) {
      completed.push(task);
    } else if (isTaskPastDue(task, now)) {
      pastDue.push(task);
    } else {
      upcoming.push(task);
    }
  }

  // 1. Upcoming: Sorted ascending by due date (nearest deadline first)
  upcoming.sort((a, b) => {
    const timeA = new Date(a.due_date).getTime() || 0;
    const timeB = new Date(b.due_date).getTime() || 0;
    return timeA - timeB;
  });

  // 2. Past Due: Sorted descending by due date (most recently overdue first)
  pastDue.sort((a, b) => {
    const timeA = new Date(a.due_date).getTime() || 0;
    const timeB = new Date(b.due_date).getTime() || 0;
    return timeB - timeA;
  });

  // 3. Completed: Sorted descending by due date / completion
  completed.sort((a, b) => {
    const timeA = new Date(a.due_date).getTime() || 0;
    const timeB = new Date(b.due_date).getTime() || 0;
    return timeB - timeA;
  });

  return { upcoming, pastDue, completed };
}
