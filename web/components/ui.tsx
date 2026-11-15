'use client';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, X } from 'lucide-react';

export function Checkbox({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean;
}) {
  return <CheckboxPrimitive.Root className="checkbox" checked={checked} disabled={disabled}
    onCheckedChange={value => onChange(value === true)} aria-label={label}>
    <CheckboxPrimitive.Indicator><Check size={17} strokeWidth={2.4}/></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}

export function Modal({ open, onOpenChange, title, description, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: React.ReactNode;
}) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal><DialogPrimitive.Overlay className="modal-overlay"/>
      <DialogPrimitive.Content className="modal">
        <DialogPrimitive.Title className="modal-title">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="muted modal-description">{description}</DialogPrimitive.Description>
        <DialogPrimitive.Close className="icon-button modal-close" aria-label="Закрыть"><X size={20}/></DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
