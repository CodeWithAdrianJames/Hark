'use client';

import React from 'react';
import { TaskTableRow, type TaskTableRowProps } from './TaskTableRow';
import { type TaskItem } from './TaskCard';

export interface TaskRowProps extends TaskTableRowProps {}

export const TaskRow: React.FC<TaskRowProps> = (props) => {
  return <TaskTableRow {...props} />;
};

export default TaskRow;
export { TaskTableRow };
export type { TaskItem };
