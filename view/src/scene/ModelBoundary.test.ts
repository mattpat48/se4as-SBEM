import { createElement } from 'react';
import { ModelBoundary } from './ModelBoundary';

test('a failed model load hides only that layer and is reported, the rest of the scene stays', () => {
  const child = createElement('group');
  const boundary = new ModelBoundary({ name: 'arredi', children: child });
  expect(boundary.render()).toBe(child);

  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    boundary.state = ModelBoundary.getDerivedStateFromError();
    boundary.componentDidCatch(new Error('not a glb'));
  } finally {
    console.error = original;
  }
  expect(boundary.render()).toBeNull();
  expect(String(errors[0])).toContain('arredi');
});
