import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { ClassProp } from 'class-variance-authority/types';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

const buttonVariants: (
  props?:
    | ({
        variant?:
          | 'default'
          | 'link'
          | 'submit'
          | 'outline'
          | 'destructive'
          | 'secondary'
          | 'ghost'
          | null
          | undefined;
        size?: 'default' | 'icon' | 'sm' | 'lg' | null | undefined;
      } & ClassProp)
    | undefined,
) => string = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-green-700 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-green-500 text-primary-foreground hover:bg-green-600',
        destructive:
          'bg-surface-destructive text-destructive-foreground hover:bg-surface-destructive-hover',
        outline:
          'border border-border-light bg-transparent text-text-primary hover:border-border-medium hover:bg-surface-hover',
        secondary:
          'border border-border-light bg-surface-secondary text-text-primary hover:bg-surface-hover',
        ghost: 'bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        link: 'text-green-500 underline-offset-4 hover:text-green-400 hover:underline',
        submit: 'bg-surface-submit text-primary-foreground hover:bg-surface-submit-hover',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-[9px] px-3',
        lg: 'h-11 rounded-xl px-8',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button: React.ForwardRefExoticComponent<
  ButtonProps & React.RefAttributes<HTMLButtonElement>
> = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
