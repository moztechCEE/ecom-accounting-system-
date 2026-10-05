import { Modal, message as antdMessage } from 'antd'

export type RepairMessage = ReturnType<typeof antdMessage.useMessage>[0]

/** Render through the existing React root; static Ant Design v5 render is unavailable in React 19. */
export function useRepairFeedback(inheritedMessage?: RepairMessage) {
  const [modal, modalHolder] = Modal.useModal()
  const [localMessage, messageHolder] = antdMessage.useMessage()
  return {
    modal,
    message: inheritedMessage ?? localMessage,
    contextHolder: <>{modalHolder}{!inheritedMessage && messageHolder}</>,
  }
}
