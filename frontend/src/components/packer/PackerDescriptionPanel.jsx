// p3portal.org
import { getPackerDescription } from '../../api/packer'
import DescriptionPanel from '../ui/DescriptionPanel'

export default function PackerDescriptionPanel({ templateId }) {
  return <DescriptionPanel resourceId={templateId} fetchFn={getPackerDescription} />
}
