package net.aliasvault.app.credentialprovider

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import com.google.android.material.button.MaterialButton
import net.aliasvault.app.R
import net.aliasvault.app.credentialprovider.models.PasskeyRegistrationViewModel

/**
 * Fragment that shows the passkey selection screen.
 * Displays options to create new, replace existing passkeys, or merge with existing credentials.
 */
class PasskeySelectionFragment : Fragment() {

    private val viewModel: PasskeyRegistrationViewModel by activityViewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View? {
        return inflater.inflate(R.layout.fragment_passkey_selection, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val headerTitle = view.findViewById<TextView>(R.id.headerTitle)
        val headerSubtitle = view.findViewById<TextView>(R.id.headerSubtitle)
        val createNewButton = view.findViewById<MaterialButton>(R.id.createNewButton)
        val existingPasskeysContainer = view.findViewById<LinearLayout>(R.id.existingPasskeysContainer)
        val existingPasskeysSection = view.findViewById<View>(R.id.existingPasskeysSection)
        val existingItemsSection = view.findViewById<View>(R.id.existingItemsSection)
        val existingItemsContainer = view.findViewById<LinearLayout>(R.id.existingItemsContainer)
        val cancelButton = view.findViewById<MaterialButton>(R.id.cancelButton)

        // Set title and subtitle
        headerTitle.text = getString(R.string.create_passkey_title)
        headerSubtitle.text = getString(R.string.create_passkey_subtitle)

        // Set up create new button
        createNewButton.setOnClickListener {
            viewModel.onCreateNewSelected()
            navigateToForm(isReplace = false, passkeyId = null, itemId = null)
        }

        val layoutInflater = LayoutInflater.from(requireContext())

        // Show existing Items without passkeys section (for merging)
        if (viewModel.existingItemsWithoutPasskey.isNotEmpty()) {
            existingItemsSection?.visibility = View.VISIBLE

            viewModel.existingItemsWithoutPasskey.forEach { itemInfo ->
                val itemView = layoutInflater.inflate(R.layout.item_existing_passkey, existingItemsContainer, false)

                val displayNameView = itemView.findViewById<TextView>(R.id.passkeyDisplayName)
                val subtitleView = itemView.findViewById<TextView>(R.id.passkeySubtitle)

                displayNameView.text = itemInfo.serviceName ?: viewModel.rpId
                val subtitle = buildString {
                    itemInfo.username?.let { append(it) }
                }
                subtitleView.text = subtitle.ifEmpty { itemInfo.url ?: viewModel.rpId }

                itemView.setOnClickListener {
                    viewModel.onMergeSelected(itemInfo)
                    navigateToForm(isReplace = false, passkeyId = null, itemId = itemInfo.itemId.toString())
                }

                existingItemsContainer?.addView(itemView)
            }
        } else {
            existingItemsSection?.visibility = View.GONE
        }

        // Show existing passkeys section (for replacement)
        if (viewModel.existingPasskeys.isNotEmpty()) {
            existingPasskeysSection?.visibility = View.VISIBLE

            viewModel.existingPasskeys.forEach { passkeyInfo ->
                val itemView = layoutInflater.inflate(R.layout.item_existing_passkey, existingPasskeysContainer, false)

                val displayNameView = itemView.findViewById<TextView>(R.id.passkeyDisplayName)
                val subtitleView = itemView.findViewById<TextView>(R.id.passkeySubtitle)

                displayNameView.text = passkeyInfo.passkey.displayName
                val subtitle = buildString {
                    passkeyInfo.username?.let { append(it) }
                    if (passkeyInfo.username != null && passkeyInfo.serviceName != null) {
                        append(" • ")
                    }
                    passkeyInfo.serviceName?.let { append(it) }
                }
                subtitleView.text = subtitle.ifEmpty { viewModel.rpId }

                itemView.setOnClickListener {
                    viewModel.onReplaceSelected(passkeyInfo)
                    navigateToForm(isReplace = true, passkeyId = passkeyInfo.passkey.id.toString(), itemId = null)
                }

                existingPasskeysContainer.addView(itemView)
            }
        } else {
            existingPasskeysSection?.visibility = View.GONE
        }

        // Set up cancel button
        cancelButton.setOnClickListener {
            requireActivity().setResult(android.app.Activity.RESULT_CANCELED)
            requireActivity().finish()
        }
    }

    private fun navigateToForm(isReplace: Boolean, passkeyId: String?, itemId: String?) {
        val fragment = PasskeyFormFragment.newInstance(isReplace, passkeyId, itemId)
        parentFragmentManager.beginTransaction()
            .setCustomAnimations(
                R.anim.slide_in_right,
                R.anim.slide_out_left,
                R.anim.slide_in_left,
                R.anim.slide_out_right,
            )
            .replace(R.id.fragmentContainer, fragment)
            .addToBackStack(null)
            .commit()
    }
}
