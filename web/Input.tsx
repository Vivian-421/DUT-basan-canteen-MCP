import * as React from 'react';
import { cn } from './utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>> =
  React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
    return (
      <input
        className={cn(
          'flex h-10 w-full rounded-[10px] border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary ring-offset-background transition-colors placeholder:text-muted-foreground hover:border-border-medium focus-visible:border-green-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-green-700 disabled:cursor-not-allowed disabled:opacity-50',
          className ?? '',
        )}
        ref={ref}
        {...props}
      />
    );
  });

Input.displayName = 'Input';

export { Input };
