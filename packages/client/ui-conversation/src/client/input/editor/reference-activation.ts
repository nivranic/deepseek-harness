/** Route composer clicks through the live reference owner without editing the draft. */
import {
  $getNearestNodeFromDOMNode, $getSelection, $isRangeSelection,
  $nodesOfType, CLICK_COMMAND, COMMAND_PRIORITY_LOW,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import type { ReferenceInsert, ReferencePreviewAvailability } from '../../contract/input.ts'
import { ReferenceChipNode, $isReferenceChipNode } from './chip-node.tsx'
import { TextRefNode } from './text-ref.ts'

/**
 * Install preview activation for atomic chips and editable reference tokens.
 * @param editor - composer editor.
 * @param open - live source routing; false preserves ordinary editor handling.
 * @param canOpen - current side-effect-free preview eligibility.
 * @returns command disposer.
 */
export function registerReferenceActivation(
  editor: LexicalEditor,
  open: (source: string | undefined, reference: Pick<ReferenceInsert, 'ref' | 'appearance'>) => boolean,
  canOpen: ReferencePreviewAvailability,
): () => void {
  const chipReference = (node: ReferenceChipNode): Pick<ReferenceInsert, 'ref' | 'appearance'> => {
    const appearance = node.getAppearance()
    return { ref: node.getReference(), ...appearance === undefined ? {} : { appearance } }
  }
  return mergeRegister(
    editor.registerNodeTransform(ReferenceChipNode, (node) => {
      node.setOpenable(!node.isInvalid() && canOpen(node.getSource(), chipReference(node)))
    }),
    editor.registerNodeTransform(TextRefNode, (node) => {
      node.setOpenable(canOpen(undefined, { ref: node.getTextContent() }))
    }),
    editor.registerCommand(CLICK_COMMAND, (event) => {
      if (event.target === null || event.button !== 0 || event.detail > 1) return false
      const selection = $getSelection()
      if ($isRangeSelection(selection) && !selection.isCollapsed()) return false
      const node = $getNearestNodeFromDOMNode(event.target as Node)
      if ($isReferenceChipNode(node)) {
        if (node.isInvalid()) return false
        const reference = chipReference(node)
        return canOpen(node.getSource(), reference) && open(node.getSource(), reference)
      }
      if (!(node instanceof TextRefNode)) return false
      const reference = { ref: node.getTextContent() }
      return canOpen(undefined, reference) && open(undefined, reference)
    }, COMMAND_PRIORITY_LOW),
  )
}

/**
 * Refresh transient preview styling after an owner or viewer changes.
 * @param editor - composer retaining its current draft and selection.
 */
export function refreshReferenceAvailability(editor: LexicalEditor): void {
  editor.update(() => {
    for (const node of [...$nodesOfType(ReferenceChipNode), ...$nodesOfType(TextRefNode)]) node.markDirty()
  })
}
